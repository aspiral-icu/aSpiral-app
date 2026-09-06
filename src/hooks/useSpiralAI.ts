/**
 * Spiral AI Hook - Enterprise Grade with Deterministic FSM
 * 
 * APEX Architecture Phase 1: The Brain
 * - Uses SpiralMachine for strict state transitions
 * - Maintains backward-compatible API surface
 * - Prevents race conditions via event-driven state management
 * 
 * BREAKTHROUGH QUALITY V2:
 * - No generic breakthrough fallback strings
 * - Stale breakthrough data cannot leak into cinematics
 * - forceBreakthrough() / skipToBreakthrough() gated by validation
 * - Frustration/skip paths request real synthesis instead of faking
 */

import { useState, useCallback, useRef, useReducer, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import { createLogger } from "@/lib/logger";
import { trackBreakthroughRejected, type BreakthroughRejectionReason } from "@/lib/analytics";
import { isUserFrustrated, wantsToSkip } from "@/lib/frustrationDetector";
import { validateCoherence, deduplicateEntities, prioritizeEntities } from "@/lib/coherenceValidator";
import { getEntityLimit, type UserTier } from "@/lib/entityLimits";
import { matchEnergy, adjustQuestionEnergy } from "@/lib/energyMatcher";
import { antiRepetition } from "@/lib/antiRepetition";
import { featureFlags } from "@/lib/featureFlags";
import { loadStoredSettings } from "@/lib/settings";
import {
  detectPatternsEarly,
  shouldStopAsking,
  getStageQuestion,
  advanceStage,
  createFastTrackState,
  type ConversationStage,
  type Pattern,
  type FastTrackState,
} from "@/lib/fastTrack";
import {
  spiralReducer,
  createInitialContext,
  isProcessing as isMachineProcessing,
  canStartProcessing,
  canTriggerCinematic,
  type SpiralContext,
  type SpiralEvent,
  type SpiralState,
  type ProcessingSubState,
} from "@/lib/spiralMachine";
import type { EntityType, EntityMetadata, Entity } from "@/lib/types";
import type { SpiralError } from "@/types/errors";

const logger = createLogger("useSpiralAI");

const SPIRAL_AI_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spiral-ai`;

const AI_REQUEST_TIMEOUT_MS = 30_000;
const RETRY_BASE_MS = 500;
const MAX_RETRIES = 2;
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_THRESHOLD = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCorsLikeError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const message = err.message.toLowerCase();
  return message.includes("cors") || message.includes("networkerror") || message.includes("failed to fetch");
}

export function computeCircuitBreakerState(timestamps: number[], now: number): { active: boolean; next: number[] } {
  const next = [...timestamps.filter((ts) => now - ts <= CIRCUIT_WINDOW_MS), now];
  return { active: next.length >= CIRCUIT_THRESHOLD, next };
}


// Minimum stage required before breakthrough can trigger
const BREAKTHROUGH_MIN_STAGE: ConversationStage = "blocker";
// Minimum entities that must be visualized before breakthrough
const BREAKTHROUGH_MIN_ENTITIES = 2;
const ULTRA_FAST_MIN_FRICTION_ENTITIES = 5;
const ULTRA_FAST_MIN_SENTENCES = 5;

/** Read maxQuestions from persisted settings (floor of 3). */
function getMaxQuestions(): number {
  const stored = loadStoredSettings();
  return Math.max(stored?.maxQuestions ?? 5, 3);
}

// =============================================================================
// BREAKTHROUGH QUALITY V2: Anti-generic validation
// =============================================================================

const GENERIC_BREAKTHROUGH_PHRASES = [
  "trust the process",
  "move forward with clarity",
  "one small step",
  "take a deep breath",
  "the answer is within you",
  "path forward is becoming clear",
  "challenge you're working through",
  "let's cut to what matters",
  "you've got this",
  "believe in yourself",
  "embrace the uncertainty",
  "everything happens for a reason",
  "journey of self-discovery",
  "step outside your comfort zone",
  "it's okay to not be okay",
  "you are not alone",
  "the first step is always the hardest",
  "you deserve to be happy",
  "growth comes from discomfort",
  "let go of what no longer serves you",
];

/**
 * Validates breakthrough data is complete, non-empty, and non-generic.
 * Returns true only if all three fields exist, are non-empty after trim,
 * and do not contain known generic filler phrases.
 */
export function isValidBreakthroughData(
  data: BreakthroughData | null | undefined
): data is BreakthroughData {
  if (!data) return false;
  const { friction, grease, insight } = data;
  if (!friction?.trim() || !grease?.trim() || !insight?.trim()) return false;

  if (featureFlags.breakthroughQualityV2) {
    const combined = `${friction} ${grease} ${insight}`.toLowerCase();
    const matchedPhrase = GENERIC_BREAKTHROUGH_PHRASES.find(phrase => combined.includes(phrase));
    if (matchedPhrase) {
      return false;
    }
  }

  return true;
}

/** Returns the first banned phrase found in the data, or undefined. */
function findMatchedGenericPhrase(data: { friction?: string; grease?: string; insight?: string } | null | undefined): string | undefined {
  if (!data) return undefined;
  const combined = `${data.friction ?? ''} ${data.grease ?? ''} ${data.insight ?? ''}`.toLowerCase();
  return GENERIC_BREAKTHROUGH_PHRASES.find(phrase => combined.includes(phrase));
}

// =============================================================================
// TYPES
// =============================================================================

interface EntityResult {
  type: EntityType;
  label: string;
  role?: string;
  emotionalValence?: number;
  importance?: number;
  positionHint?: string;
}

interface ConnectionResult {
  from: number;
  to: number;
  type: "causes" | "blocks" | "enables" | "resolves" | "opposes";
  strength: number;
}

interface SpiralAIResponse {
  entities: EntityResult[];
  connections: ConnectionResult[];
  question: string;
  response: string;
  friction?: string;
  grease?: string;
  insight?: string;
}

interface BreakthroughData {
  friction: string;
  grease: string;
  insight: string;
}

interface UltraFastProgress {
  sentenceCount: number;
  frictionEntityCount: number;
}

function countSentences(text: string): number {
  // Performance Optimization: Replaced O(N) .split().map().filter() which creates
  // multiple intermediate arrays with a single-pass O(N) time, O(1) space loop.
  let count = 0;
  let hasContent = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '.' || char === '!' || char === '?') {
      if (hasContent) {
        count++;
        hasContent = false;
      }
    } else if (char.trim() !== '') {
      hasContent = true;
    }
  }

  if (hasContent) {
    count++;
  }

  return count;
}

function updateUltraFastProgress(
  previous: UltraFastProgress,
  transcript: string,
  entities: EntityResult[]
): UltraFastProgress {
  // Performance Optimization: Use a single-pass loop instead of .filter().length
  // to avoid intermediate array allocations and GC pressure when computing counts.
  let frictionFromBatch = 0;
  for (let i = 0; i < entities.length; i++) {
    if (entities[i].type === "friction") {
      frictionFromBatch++;
    }
  }

  return {
    sentenceCount: previous.sentenceCount + countSentences(transcript),
    frictionEntityCount: previous.frictionEntityCount + frictionFromBatch,
  };
}

function isUltraFastBreakthroughReady(progress: UltraFastProgress): boolean {
  return (
    progress.sentenceCount >= ULTRA_FAST_MIN_SENTENCES &&
    progress.frictionEntityCount >= ULTRA_FAST_MIN_FRICTION_ENTITIES
  );
}

interface UseSpiralAIOptions {
  onEntitiesExtracted?: (entities: EntityResult[]) => void;
  onCoherenceCheck?: (result: { valid: boolean; score: number; removed: string[] }) => void;
  onQuestion?: (question: string, stage: ConversationStage) => void;
  onBreakthrough?: (data?: BreakthroughData) => void;
  onPatternDetected?: (patterns: Pattern[]) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: SpiralState, subState: ProcessingSubState) => void;
  autoSendInterval?: number;
  userTier?: UserTier;
}

export function useSpiralAI(options: UseSpiralAIOptions = {}) {
  const { autoSendInterval = 10000, userTier = "free" } = options;
  const entityLimit = getEntityLimit(userTier);
  
  // Store options in ref to avoid stale closures
  const optionsRef = useRef(options);
  optionsRef.current = options;
  
  // =========================================================================
  // DETERMINISTIC FSM - The Brain
  // =========================================================================
  const [machineContext, dispatch] = useReducer(spiralReducer, undefined, createInitialContext);
  
  // Typed dispatch helper - simple, no side effects
  const sendEvent = useCallback((event: SpiralEvent) => {
    dispatch(event);
  }, []);
  
  // State change callback via useEffect (safe, avoids race conditions)
  const previousStateRef = useRef(machineContext.state);
  useEffect(() => {
    if (previousStateRef.current !== machineContext.state) {
      optionsRef.current.onStateChange?.(machineContext.state, machineContext.processingSubState);
      previousStateRef.current = machineContext.state;
    }
  }, [machineContext.state, machineContext.processingSubState]);
  
  // =========================================================================
  // DERIVED STATE (Backward Compatible API)
  // =========================================================================
  const isProcessing = useMemo(() => isMachineProcessing(machineContext), [machineContext]);
  const processingStage = machineContext.processingSubState;
  const showCinematic = machineContext.state === "CINEMATIC";
  const machineError = machineContext.error;
  
  // =========================================================================
  // LEGACY STATE (Will be migrated to FSM in future phases)
  // =========================================================================
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<ConversationStage>("friction");
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [breakthroughData, setBreakthroughData] = useState<BreakthroughData | null>(null);
  const [showBreakthroughCard, setShowBreakthroughCard] = useState(false);
  const [ultraFastMode, setUltraFastMode] = useState(false);
  const [cinematicComplete, setCinematicComplete] = useState(false);
  const [error, setError] = useState<SpiralError | null>(null);
  const [degradedMessage, setDegradedMessage] = useState<string | null>(null);
  
  // =========================================================================
  // REFS (Mutable State)
  // =========================================================================
  const transcriptBufferRef = useRef<string>("");
  const lastSendTimeRef = useRef<number>(0);
  const conversationHistoryRef = useRef<string[]>([]);
  const fastTrackRef = useRef<FastTrackState>(createFastTrackState());
  const patternsRef = useRef<Pattern[]>([]);
  const lastFlushRef = useRef<{ text: string; ts: number } | null>(null);
  const synthesisInProgressRef = useRef(false);
  const failureTimestampsRef = useRef<number[]>([]);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultraFastProgressRef = useRef<UltraFastProgress>({
    sentenceCount: 0,
    frictionEntityCount: 0,
  });

  const {
    currentSession,
    addEntity,
    addConnection,
    addMessage,
    triggerBreakthrough,
  } = useSessionStore();

  // =========================================================================
  // CINEMATIC CONTROL (FSM-Driven)
  // =========================================================================
  
  const setShowCinematic = useCallback((show: boolean) => {
    if (show && canTriggerCinematic(machineContext)) {
      sendEvent({ type: "TRIGGER_CINEMATIC" });
    } else if (!show && machineContext.state === "CINEMATIC") {
      sendEvent({ type: "CINEMATIC_COMPLETE" });
    }
  }, [machineContext, sendEvent]);

  // Force breakthrough with cinematic sequence
  const forceBreakthrough = useCallback((data?: BreakthroughData) => {
    // V2: Gate - require valid data when flag is ON
    if (featureFlags.breakthroughQualityV2 && !isValidBreakthroughData(data)) {
      const d = data as BreakthroughData | undefined;
      logger.warn("FORCE_BREAKTHROUGH blocked: no valid breakthrough data", {
        hasData: !!d,
        friction: d?.friction?.substring(0, 30),
        grease: d?.grease?.substring(0, 30),
        insight: d?.insight?.substring(0, 30),
      });
      const matched = findMatchedGenericPhrase(d);
      trackBreakthroughRejected({
        reason: matched ? 'generic_phrase' : 'empty_or_partial',
        source: 'forceBreakthrough',
        friction: d?.friction, grease: d?.grease, insight: d?.insight,
        matchedPhrase: matched,
      });
      return;
    }

    logger.info("FORCING BREAKTHROUGH", {
      reason: data ? "synthesis_complete" : "user_action",
      patterns: patternsRef.current.map(p => p.name),
      hasData: !!data,
      currentState: machineContext.state,
    });

    setCurrentQuestion(null);
    setCurrentStage("breakthrough");
    fastTrackRef.current = createFastTrackState();

    // V2: Clear stale data before setting new
    setBreakthroughData(null);

    // Store breakthrough data
    if (data) {
      setBreakthroughData(data);
      logger.info("Breakthrough data set", {
        friction: data.friction?.substring(0, 50),
        grease: data.grease?.substring(0, 50),
        insight: data.insight?.substring(0, 50),
      });
    }

    // Trigger cinematic via FSM
    if (canTriggerCinematic(machineContext)) {
      sendEvent({ type: "TRIGGER_CINEMATIC" });
      setCinematicComplete(false);
    setError(null);
    setDegradedMessage(null);
    failureTimestampsRef.current = [];
      logger.info("Cinematic triggered via FSM, waiting for completion");
    } else {
      logger.warn("Cannot trigger cinematic from current state", { state: machineContext.state });
    }
  }, [machineContext, sendEvent]);

  // Handle cinematic completion
  const handleCinematicComplete = useCallback(() => {
    logger.info("Cinematic complete, triggering breakthrough effects");

    setCinematicComplete(true);
    sendEvent({ type: "CINEMATIC_COMPLETE" });
    triggerBreakthrough(); // Visual effects in 3D scene

    // Show breakthrough card after cinematic
    setTimeout(() => {
      const data = breakthroughData;

      if (isValidBreakthroughData(data)) {
        setShowBreakthroughCard(true);
        options.onBreakthrough?.(data);

        // Format breakthrough message
        addMessage({
          role: "assistant",
          content: `✨ **BREAKTHROUGH** ✨

**The Friction:** ${data.friction}

**The Grease:** ${data.grease}

**💡 ${data.insight}**`,
        });
      } else if (featureFlags.breakthroughQualityV2) {
        // V2: Do NOT show fake breakthrough. Log warning and dismiss.
        logger.warn("Cinematic completed but no valid breakthrough data — suppressing fake card");
        trackBreakthroughRejected({
          reason: 'cinematic_no_data',
          source: 'handleCinematicComplete',
          friction: (data as any)?.friction, grease: (data as any)?.grease, insight: (data as any)?.insight,
          matchedPhrase: findMatchedGenericPhrase(data as any),
        });
        setShowBreakthroughCard(false);
      } else {
        // Legacy: show generic message (flag OFF)
        setShowBreakthroughCard(true);
        options.onBreakthrough?.();
        addMessage({
          role: "assistant",
          content: "✨ **BREAKTHROUGH** ✨\n\nLet's cut to what matters.",
        });
      }
    }, 300); // Brief delay for visual polish
  }, [breakthroughData, triggerBreakthrough, addMessage, options, sendEvent]);

  // Dismiss breakthrough card
  const dismissBreakthroughCard = useCallback(() => {
    setShowBreakthroughCard(false);
  }, []);

  // Toggle ultra-fast mode
  const toggleUltraFastMode = useCallback((enabled: boolean) => {
    setUltraFastMode(enabled);
    fastTrackRef.current.readyForBreakthrough = false;
    ultraFastProgressRef.current = {
      sentenceCount: 0,
      frictionEntityCount: 0,
    };

    logger.info("Ultra-fast mode toggled", {
      enabled,
      minSentences: ULTRA_FAST_MIN_SENTENCES,
      minFrictionEntities: ULTRA_FAST_MIN_FRICTION_ENTITIES,
    });
  }, []);

  // =========================================================================
  // BREAKTHROUGH QUALITY V2: Request real synthesis from server
  // =========================================================================

  const requestSynthesis = useCallback(async () => {
    if (synthesisInProgressRef.current) {
      logger.warn("Synthesis already in progress, skipping duplicate request");
      return;
    }
    synthesisInProgressRef.current = true;

    // Clear stale breakthrough data
    setBreakthroughData(null);

    try {
      // Build a summary transcript from conversation history
      const history = conversationHistoryRef.current;
      const summaryTranscript = history.length > 0
        ? history.slice(-5).join(" ")
        : "The user wants their breakthrough now.";

      logger.info("requestSynthesis: requesting real breakthrough from server", {
        historyLength: history.length,
      });

      // Mark ready for breakthrough so processTranscript sends forceBreakthrough=true
      fastTrackRef.current.readyForBreakthrough = true;

      // Call processTranscript which will handle the full server round-trip
      await processTranscriptInner(summaryTranscript);
    } catch (error) {
      logger.error("requestSynthesis failed", error as Error);
      // Stay in recoverable state — do NOT fake a breakthrough
    } finally {
      synthesisInProgressRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // CORE PROCESSING (FSM-Driven)
  // =========================================================================

  const processTranscriptInner = useCallback(
    async (transcript: string): Promise<SpiralAIResponse | null> => {
      // FSM Guard: Check if we can start processing
      if (!transcript.trim()) return null;
      
      if (!canStartProcessing(machineContext)) {
        logger.warn("Cannot start processing from current state", {
          currentState: machineContext.state,
        });
        return null;
      }

      // Track conversation history
      conversationHistoryRef.current.push(transcript);

      // EARLY PATTERN DETECTION - Don't wait for 5+ messages
      const detectedPatterns = detectPatternsEarly(transcript, conversationHistoryRef.current);
      if (detectedPatterns.length > 0) {
        patternsRef.current = detectedPatterns;
        fastTrackRef.current.detectedPatterns = detectedPatterns;
        options.onPatternDetected?.(detectedPatterns);
        logger.info("Patterns detected", { patterns: detectedPatterns.map(p => `${p.name}:${p.confidence}`) });
      }

      // SMART STOPPING - Check if we should force breakthrough
      const effectiveMaxQ = getMaxQuestions();
      const stopCheck = shouldStopAsking(
        transcript,
        conversationHistoryRef.current,
        patternsRef.current,
        fastTrackRef.current.questionsAsked,
        effectiveMaxQ,
      );

      if (stopCheck.stop) {
        const stage = fastTrackRef.current.stage;
        const entityCount = currentSession?.entities?.length ?? 0;

        // Stage gate: must be at least "blocker" stage before breakthrough
        // Entity gate: must have at least 2 entities visualized
        if (stage === "friction" || stage === "desire") {
          logger.info("Stop requested but stage too early, continuing spiral", { stage, reason: stopCheck.reason });
          trackBreakthroughRejected({
            reason: 'stage_gate',
            source: 'shouldStopAsking',
            friction: undefined, grease: undefined, insight: undefined,
            matchedPhrase: undefined,
          });
          fastTrackRef.current.stage = advanceStage(stage);
        } else if (entityCount < BREAKTHROUGH_MIN_ENTITIES) {
          logger.info("Stop requested but not enough entities visualized", { entityCount, reason: stopCheck.reason });
          trackBreakthroughRejected({
            reason: 'entity_gate',
            source: 'shouldStopAsking',
            friction: undefined, grease: undefined, insight: undefined,
            matchedPhrase: undefined,
          });
        } else {
          logger.info("Stopping questions", { reason: stopCheck.reason, stage, entityCount });
          fastTrackRef.current.readyForBreakthrough = true;
        }
      }

      logger.info("Processing transcript via FSM", { 
        length: transcript.length,
        stage: fastTrackRef.current.stage,
        questionsAsked: fastTrackRef.current.questionsAsked,
        readyForBreakthrough: fastTrackRef.current.readyForBreakthrough,
        currentState: machineContext.state,
      });
      
      // FSM Transition: START_PROCESSING
      sendEvent({ 
        type: "START_PROCESSING", 
        payload: { forceBreakthrough: fastTrackRef.current.readyForBreakthrough } 
      });

      try {
        // Get stage-specific prompt hints
        const stageConfig = getStageQuestion(fastTrackRef.current.stage);
        
        let response: Response | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => abortController.abort(), AI_REQUEST_TIMEOUT_MS);
          try {
            const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
            const accessToken = sessionData?.session?.access_token;
            const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

            response = await fetch(SPIRAL_AI_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(anonKey ? { "apikey": anonKey } : {}),
                ...(accessToken ? { "Authorization": `Bearer ${accessToken}` } : (anonKey ? { "Authorization": `Bearer ${anonKey}` } : {})),
              },
          body: JSON.stringify({
            transcript,
            stream: true,
            sessionContext: currentSession ? {
              entities: currentSession.entities.map(e => ({
                type: e.type,
                label: e.label,
              })),
              conversationHistory: conversationHistoryRef.current.slice(-5),
              questionsAsked: fastTrackRef.current.questionsAsked,
              stage: fastTrackRef.current.stage,
              detectedPatterns: patternsRef.current,
            } : undefined,
            forceBreakthrough: fastTrackRef.current.readyForBreakthrough,
            stagePrompt: stageConfig.systemPrompt,
          }),
            signal: abortController.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            if (response.status >= 500 && attempt < MAX_RETRIES) {
              await delay(RETRY_BASE_MS * (2 ** attempt));
              continue;
            }
            if (response.status >= 400 && response.status < 500) {
              throw new Error(`HTTP_${response.status}`);
            }
            throw new Error(`HTTP_${response.status}`);
          }
          break;
        } catch (err) {
          clearTimeout(timeoutId);
          lastErr = err;
          const maybeStatus = response?.status ?? 0;
          const retryable = maybeStatus >= 500 || err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
          if (retryable && attempt < MAX_RETRIES) {
            await delay(RETRY_BASE_MS * (2 ** attempt));
            continue;
          }
          throw err;
        }
        }

        if (!response) throw (lastErr instanceof Error ? lastErr : new Error("No response"));

        // Track server-side breakthrough rejection for client-server correlation
        const breakthroughRejected = response.headers.get("X-Breakthrough-Rejected");
        if (breakthroughRejected === "true" && featureFlags.breakthroughQualityV2) {
          trackBreakthroughRejected({
            reason: 'force_blocked',
            source: 'parse',
            friction: undefined,
            grease: undefined,
            insight: undefined,
          });
          logger.warn("Server rejected breakthrough (X-Breakthrough-Rejected header)");
        }

        // FSM Transition: START_DELIBERATING (AI thinking)
        sendEvent({ type: "START_DELIBERATING" });

        // Check if response is SSE stream or JSON
        const contentType = response.headers.get("content-type") || "";
        let data: SpiralAIResponse;

        if (contentType.includes("text/event-stream") && response.body) {
          // Handle SSE streaming
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedResponse = "";
          let metadata: Partial<SpiralAIResponse> = {};
          let buffer = "";

          // Add a streaming assistant message
          const streamingMessage = addMessage({
            role: "assistant",
            content: "",
            isStreaming: true,
          });

          // FSM Transition: START_RESPONDING
          sendEvent({ type: "START_RESPONDING" });

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === "chunk" && parsed.content) {
                  accumulatedResponse += parsed.content;
                  // Update the streaming message in real-time
                  useSessionStore.getState().updateMessage(streamingMessage.id, {
                    content: accumulatedResponse,
                  });
                } else if (parsed.type === "metadata") {
                  metadata = parsed;
                }
              } catch {
                // Incomplete JSON
              }
            }
          }

          // Build the full response data
          data = {
            entities: (metadata.entities as SpiralAIResponse["entities"]) || [],
            connections: (metadata.connections as SpiralAIResponse["connections"]) || [],
            question: (metadata.question as string) || "",
            response: accumulatedResponse,
            friction: metadata.friction as string | undefined,
            grease: metadata.grease as string | undefined,
            insight: metadata.insight as string | undefined,
          };

          // Update the streaming message with final content and mark done
          useSessionStore.getState().updateMessage(streamingMessage.id, {
            content: accumulatedResponse,
            isStreaming: false,
          });

          logger.info("SSE stream complete", {
            responseLength: accumulatedResponse.length,
            entityCount: data.entities.length,
            hasQuestion: !!data.question,
          });
        } else {
          // Fallback: standard JSON response
          data = await response.json();

          // FSM Transition: START_RESPONDING
          sendEvent({ type: "START_RESPONDING" });

          logger.info("AI response received (JSON)", {
            entityCount: data.entities.length,
            hasQuestion: !!data.question,
          });
        }

        logger.info("AI response received", {
          entityCount: data.entities.length,
          hasQuestion: !!data.question,
        });

        // FSM Transition: START_RESPONDING
        sendEvent({ type: "START_RESPONDING" });

        // Process entities with coherence validation
        let processedEntities = data.entities;
        
        // 1. Hard cap by tier limit
        processedEntities = processedEntities.slice(0, entityLimit);
        if (data.entities.length > entityLimit) {
          logger.warn(`Capped entities from ${data.entities.length} to ${entityLimit}`);
        }
        
        // 2. Convert to Entity format for validation
        const tempEntities: Entity[] = processedEntities.map((e, i) => ({
          id: `temp-${i}`,
          type: e.type,
          label: e.label,
          metadata: {
            role: e.role as EntityMetadata["role"],
            valence: e.emotionalValence,
            importance: e.importance,
            positionHint: e.positionHint,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        
        // 3. Deduplicate similar entities
        const dedupedEntities = deduplicateEntities(tempEntities);
        
        // 4. Validate coherence with transcript
        const coherenceResult = validateCoherence(dedupedEntities, transcript);
        
        logger.info("Coherence validation", {
          score: coherenceResult.coherenceScore,
          valid: coherenceResult.valid,
          kept: coherenceResult.kept.length,
          removed: coherenceResult.removed,
        });
        
        options.onCoherenceCheck?.({
          valid: coherenceResult.valid,
          score: coherenceResult.coherenceScore,
          removed: coherenceResult.removed,
        });
        
        // 5. Use refined entities if coherence was low
        const validatedEntities = coherenceResult.refinedEntities;
        
        // 6. Prioritize by importance
        const finalEntities = prioritizeEntities(validatedEntities, entityLimit);

        if (ultraFastMode) {
          ultraFastProgressRef.current = updateUltraFastProgress(
            ultraFastProgressRef.current,
            transcript,
            data.entities
          );

          const ready = isUltraFastBreakthroughReady(ultraFastProgressRef.current);
          // Apply stage & entity gates even in ultra-fast mode
          const ufStage = fastTrackRef.current.stage;
          const ufEntityCount = currentSession?.entities?.length ?? 0;
          const gatedReady = ready
            && ufStage !== "friction" && ufStage !== "desire"
            && ufEntityCount >= BREAKTHROUGH_MIN_ENTITIES;
          fastTrackRef.current.readyForBreakthrough = gatedReady;

          logger.info("Ultra-fast progress", {
            sentenceCount: ultraFastProgressRef.current.sentenceCount,
            frictionEntityCount: ultraFastProgressRef.current.frictionEntityCount,
            readyForBreakthrough: gatedReady,
            stage: ufStage,
            entityCount: ufEntityCount,
          });
        }
        
        // Add entities to session with full metadata
        const createdEntityIds: string[] = [];
        if (finalEntities.length > 0) {
          finalEntities.forEach((entity) => {
            const created = addEntity({
              type: entity.type,
              label: entity.label,
              metadata: entity.metadata,
            });
            createdEntityIds.push(created.id);
          });

          // Map back to EntityResult format for callback
          const resultEntities: EntityResult[] = finalEntities.map(e => ({
            type: e.type,
            label: e.label,
            role: e.metadata?.role,
            emotionalValence: e.metadata?.valence,
            importance: e.metadata?.importance,
            positionHint: e.metadata?.positionHint,
          }));
          
          options.onEntitiesExtracted?.(resultEntities);
        }

        // Add connections (after entities are created)
        if (data.connections.length > 0 && createdEntityIds.length >= 2) {
          setTimeout(() => {
            data.connections.forEach((conn) => {
              if (createdEntityIds[conn.from] && createdEntityIds[conn.to]) {
                addConnection({
                  fromEntityId: createdEntityIds[conn.from],
                  toEntityId: createdEntityIds[conn.to],
                  type: conn.type,
                  strength: conn.strength,
                });
              }
            });
          }, 50);
        }

        // FAILSAFE: If readyForBreakthrough but server returned a question,
        // use any existing breakthrough data from prior responses
        if (fastTrackRef.current.readyForBreakthrough && data.question) {
           logger.warn("Server returned question despite breakthrough ready - checking accumulated data");

           // V2: Only use data if it passes full validation
           const candidateData: BreakthroughData = {
             friction: data.friction || "",
             grease: data.grease || "",
             insight: data.insight || "",
           };
           
           if (isValidBreakthroughData(candidateData)) {
             forceBreakthrough(candidateData);
           } else if (!featureFlags.breakthroughQualityV2 && (data.friction || data.grease || data.insight)) {
             // Legacy: accept partial data when flag is off
             forceBreakthrough(candidateData);
            } else {
              logger.warn("No valid breakthrough data in failsafe path — staying in recoverable state");
              trackBreakthroughRejected({
                reason: findMatchedGenericPhrase(candidateData as BreakthroughData) ? 'generic_phrase' : 'failsafe_no_data',
                source: 'failsafe',
                friction: (candidateData as BreakthroughData).friction, grease: (candidateData as BreakthroughData).grease, insight: (candidateData as BreakthroughData).insight,
                matchedPhrase: findMatchedGenericPhrase(candidateData as BreakthroughData),
              });
           }
           
           sendEvent({ type: "RESPONSE_COMPLETE" });
           return data;
        }

        // Track question and count with anti-repetition + energy matching
        if (data.question) {
          let processedQuestion = data.question;
          
          // Check for repetition
          if (antiRepetition.isTooSimilar(processedQuestion)) {
            logger.warn("Question too similar, keeping original for now", { question: processedQuestion });
          }
          
          // Match user's energy
          const energy = matchEnergy(transcript);
          processedQuestion = adjustQuestionEnergy(processedQuestion, energy);
          
          // Record for tracking
          antiRepetition.record(processedQuestion, "generated");
          
          logger.info("Question processed", { 
            original: data.question, 
            processed: processedQuestion,
            energy,
            stage: fastTrackRef.current.stage,
            diversityScore: antiRepetition.getDiversityScore(),
          });
          
          // Update fast track state
          fastTrackRef.current.questionsAsked++;
          fastTrackRef.current.stage = advanceStage(fastTrackRef.current.stage);
          
          setCurrentQuestion(processedQuestion);
          setCurrentStage(fastTrackRef.current.stage);
          options.onQuestion?.(processedQuestion, fastTrackRef.current.stage);
          
          // Check if this was the last allowed question (with stage gate)
          const maxQ = getMaxQuestions();
          if (fastTrackRef.current.questionsAsked >= maxQ) {
            const stage = fastTrackRef.current.stage;
            const entityCount = currentSession?.entities?.length ?? 0;
            if (stage === "friction" || stage === "desire") {
              // Not deep enough yet — advance stage and keep asking
              logger.info("Max questions reached but stage too early, advancing", { stage, entityCount });
              trackBreakthroughRejected({
                reason: 'stage_gate', source: 'shouldStopAsking',
                friction: undefined, grease: undefined, insight: undefined, matchedPhrase: undefined,
              });
              fastTrackRef.current.stage = advanceStage(stage);
            } else if (entityCount < BREAKTHROUGH_MIN_ENTITIES) {
              logger.info("Max questions reached but too few entities, continuing", { entityCount });
              trackBreakthroughRejected({
                reason: 'entity_gate', source: 'shouldStopAsking',
                friction: undefined, grease: undefined, insight: undefined, matchedPhrase: undefined,
              });
            } else {
              logger.info("Max questions reached, next response will be breakthrough");
              fastTrackRef.current.readyForBreakthrough = true;
            }
          }
          
          // FSM Transition: RESPONSE_COMPLETE
          sendEvent({ type: "RESPONSE_COMPLETE" });
        } else {
          // No question = breakthrough time
          // Extract breakthrough data with robust parsing
          try {
            let btData: BreakthroughData | null = null;

            // Method 1: Check if data has explicit fields (best)
            if (data.friction && data.grease && data.insight) {
              btData = {
                friction: data.friction,
                grease: data.grease,
                insight: data.insight,
              };
              logger.info("Breakthrough data from explicit fields", { btData });
            }

            // Method 2: Try JSON code block
            if (!btData) {
              const jsonBlockMatch = data.response?.match(/```json\s*([\s\S]*?)\s*```/);
              if (jsonBlockMatch) {
                try {
                  btData = JSON.parse(jsonBlockMatch[1]) as BreakthroughData;
                  logger.info("Breakthrough data from JSON block", { btData });
                } catch (e) {
                  logger.warn("Failed to parse JSON block", e);
                }
              }
            }

            // Method 3: Try inline JSON object
            if (!btData) {
              const objMatch = data.response?.match(/\{[\s\S]*?"friction"[\s\S]*?"grease"[\s\S]*?"insight"[\s\S]*?\}/);
              if (objMatch) {
                try {
                  btData = JSON.parse(objMatch[0]) as BreakthroughData;
                  logger.info("Breakthrough data from inline JSON", { btData });
                } catch (e) {
                  logger.warn("Failed to parse inline JSON", e);
                }
              }
            }

            // Method 4: Try parsing entire response as JSON
            if (!btData && data.response) {
              try {
                const parsed = JSON.parse(data.response);
                if (parsed.friction && parsed.grease && parsed.insight) {
                  btData = parsed as BreakthroughData;
                  logger.info("Breakthrough data from full response parse", { btData });
                }
              } catch {
                // Not valid JSON, that's okay
              }
            }

            // V2: Validate parsed data — reject generic/partial
            if (isValidBreakthroughData(btData)) {
              forceBreakthrough(btData);
            } else if (!featureFlags.breakthroughQualityV2 && btData) {
              // Legacy: accept whatever we got when flag is off
              forceBreakthrough(btData);
            } else {
              // V2: No valid breakthrough data — stay in recoverable state
              logger.warn("No valid breakthrough data found — NOT faking breakthrough");
              trackBreakthroughRejected({
                reason: findMatchedGenericPhrase(btData as BreakthroughData | null) ? 'generic_phrase' : 'parse_no_data',
                source: 'parse',
                friction: (btData as BreakthroughData | null)?.friction, grease: (btData as BreakthroughData | null)?.grease, insight: (btData as BreakthroughData | null)?.insight,
                matchedPhrase: findMatchedGenericPhrase(btData as BreakthroughData | null),
              });
              sendEvent({ type: "RESPONSE_COMPLETE" });
            }
          } catch (error) {
            logger.error("Failed to extract breakthrough data", error);
            if (!featureFlags.breakthroughQualityV2) {
              // Legacy: fallback to basic breakthrough
              forceBreakthrough();
            } else {
              // V2: Do not fake
              logger.warn("Breakthrough extraction failed — staying in recoverable state");
              sendEvent({ type: "RESPONSE_COMPLETE" });
            }
          }
        }

        // Store response (only add message if not already streamed via SSE)
        if (data.response && data.question) {
          setLastResponse(data.response);

          // Only add as chat message if we didn't already stream it
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("text/event-stream")) {
            addMessage({
              role: "assistant",
              content: data.response,
            });
          }
        }

        return data;
      } catch (err) {
        const responseStatus = err instanceof Error && err.message.startsWith("HTTP_") ? Number(err.message.split("_")[1]) : undefined;
        const spiralError: SpiralError = isCorsLikeError(err)
          ? { code: "CORS_ERROR", message: "Connection issue — please try again in a moment", retryable: true }
          : { code: "STT_FETCH_FAILED", message: "Failed to process transcript", retryable: !responseStatus || responseStatus >= 500 };

        if (spiralError.code === "CORS_ERROR") {
          console.warn("[useSpiralAI] CORS error detected — check edge function CORS config");
        }

        console.error("[useSpiralAI] Failed to process transcript:", {
          status: responseStatus,
          error: err,
          transcript: transcript?.slice(0, 50),
        });

        setError(spiralError);
        const now = Date.now();
        const circuit = computeCircuitBreakerState(failureTimestampsRef.current, now);
        failureTimestampsRef.current = circuit.next;
        if (circuit.active) {
          setDegradedMessage("Connection issue — please try again in a moment");
        }

        sendEvent({ type: "ERROR", payload: { message: spiralError.message } });
        options.onError?.(err as Error);
        return null;
      }
    },
    [currentSession, addEntity, addConnection, addMessage, machineContext, options, forceBreakthrough, sendEvent, entityLimit, ultraFastMode]
  );

  // Public processTranscript wrapper with frustration/skip gating
  const processTranscript = useCallback(
    async (transcript: string): Promise<SpiralAIResponse | null> => {
      if (!transcript.trim()) return null;

      // FRUSTRATION CHECK
      if (isUserFrustrated(transcript) || wantsToSkip(transcript)) {
        if (featureFlags.breakthroughQualityV2) {
          // V2: Don't fake breakthrough. Request real synthesis instead.
          logger.warn("User frustrated/wants to skip — requesting real synthesis");
          conversationHistoryRef.current.push(transcript);
          fastTrackRef.current.readyForBreakthrough = true;
          // Fall through to processTranscriptInner which will send forceBreakthrough=true
          return processTranscriptInner(transcript);
        } else {
          // Legacy: force breakthrough immediately
          logger.warn("User frustrated or wants to skip - forcing breakthrough");
          forceBreakthrough();
          return null;
        }
      }

      return processTranscriptInner(transcript);
    },
    [processTranscriptInner, forceBreakthrough]
  );

  // Skip to breakthrough button handler
  const skipToBreakthrough = useCallback(() => {
    if (featureFlags.breakthroughQualityV2) {
      // V2: Request real synthesis instead of faking
      logger.info("skipToBreakthrough: requesting real synthesis (V2)");
      requestSynthesis();
    } else {
      // Legacy
      forceBreakthrough();
    }
  }, [forceBreakthrough, requestSynthesis]);

  // Reset for new session
  const resetSession = useCallback(() => {
    // FSM Reset
    sendEvent({ type: "RESET" });
    
    // Legacy state reset
    fastTrackRef.current = createFastTrackState();
    conversationHistoryRef.current = [];
    patternsRef.current = [];
    antiRepetition.reset();
    setCurrentQuestion(null);
    setCurrentStage("friction");
    setLastResponse(null);
    setBreakthroughData(null);
    setShowBreakthroughCard(false);
    setUltraFastMode(false);
    ultraFastProgressRef.current = {
      sentenceCount: 0,
      frictionEntityCount: 0,
    };
    setCinematicComplete(false);
    setError(null);
    setDegradedMessage(null);
    failureTimestampsRef.current = [];
  }, [sendEvent]);

  // Accumulate transcript and auto-send periodically
  const accumulateTranscript = useCallback((text: string) => {
    transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + text;
    
    const now = Date.now();
    const timeSinceLastSend = now - lastSendTimeRef.current;

    // Auto-send if buffer is substantial and enough time has passed
    if (
      transcriptBufferRef.current.length > 50 &&
      timeSinceLastSend > autoSendInterval &&
      canStartProcessing(machineContext)
    ) {
      const buffer = transcriptBufferRef.current;
      transcriptBufferRef.current = "";
      lastSendTimeRef.current = now;
      
      // Add user message
      addMessage({
        role: "user",
        content: buffer,
      });
      
      processTranscript(buffer);
    }
  }, [autoSendInterval, machineContext, processTranscript, addMessage]);

  // Send current buffer immediately
  const sendBuffer = useCallback(() => {
    if (transcriptBufferRef.current.trim() && canStartProcessing(machineContext)) {
      const buffer = transcriptBufferRef.current;
      transcriptBufferRef.current = "";
      lastSendTimeRef.current = Date.now();

      // Add user message
      addMessage({
        role: "user",
        content: buffer,
      });

      processTranscript(buffer);
    }
  }, [machineContext, processTranscript, addMessage]);

  // Flush buffer with optional fallback (prevents stalls when only interim text exists)
  const flushTranscript = useCallback(
    (fallbackText?: string) => {
      if (!canStartProcessing(machineContext)) return;

      const buffered = transcriptBufferRef.current.trim();
      const fallback = fallbackText?.trim() || "";
      const text = buffered || fallback;
      if (!text) return;

      const now = Date.now();
      const last = lastFlushRef.current;
      if (last && last.text === text && now - last.ts < 1000) {
        return;
      }
      lastFlushRef.current = { text, ts: now };

      if (buffered) {
        transcriptBufferRef.current = "";
      }
      lastSendTimeRef.current = now;

      addMessage({
        role: "user",
        content: text,
      });

      processTranscript(text);
    },
    [machineContext, processTranscript, addMessage]
  );

  // Clear buffer
  const clearBuffer = useCallback(() => {
    transcriptBufferRef.current = "";
  }, []);

  // Clear current question
  const dismissQuestion = useCallback(() => {
    setCurrentQuestion(null);
  }, []);

  // Dismiss error (FSM transition)
  const dismissError = useCallback(() => {
    sendEvent({ type: "DISMISS_ERROR" });
  }, [sendEvent]);

  useEffect(() => {
    if (machineContext.state === "PROCESSING" || machineContext.state === "DELIBERATING" || machineContext.state === "RESPONDING") {
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = setTimeout(() => {
        const timeoutError: SpiralError = { code: "STT_TIMEOUT", message: "Connection issue — please try again in a moment", retryable: true };
        setError(timeoutError);
        sendEvent({ type: "ERROR", payload: { message: timeoutError.message } });
      }, AI_REQUEST_TIMEOUT_MS);
    } else if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  }, [machineContext.state, sendEvent]);

  useEffect(() => {
    if (machineContext.state === "ERROR") {
      if (errorResetTimeoutRef.current) clearTimeout(errorResetTimeoutRef.current);
      errorResetTimeoutRef.current = setTimeout(() => sendEvent({ type: "DISMISS_ERROR" }), 3000);
    }
  }, [machineContext.state, sendEvent]);

  // =========================================================================
  // BACKWARD COMPATIBLE RETURN API
  // =========================================================================
  return {
    // FSM State (new)
    machineState: machineContext.state,
    machineContext,
    sendEvent,
    
    // Legacy compatible state
    isProcessing,
    processingStage,
    currentQuestion,
    currentStage,
    lastResponse,
    breakthroughData,
    showBreakthroughCard,
    ultraFastMode,
    questionCount: fastTrackRef.current.questionsAsked,
    maxQuestions: getMaxQuestions(),
    detectedPatterns: patternsRef.current,
    
    // Error state (enhanced)
    machineError,
    error,
    degradedMessage,
    dismissError,
    
    // Actions
    processTranscript,
    accumulateTranscript,
    sendBuffer,
    flushTranscript,
    clearBuffer,
    dismissQuestion,
    skipToBreakthrough,
    resetSession,
    dismissBreakthroughCard,
    toggleUltraFastMode,
    
    // Cinematic control
    showCinematic,
    cinematicComplete,
    handleCinematicComplete,
    setShowCinematic,
    setCinematicComplete,
  };
}
