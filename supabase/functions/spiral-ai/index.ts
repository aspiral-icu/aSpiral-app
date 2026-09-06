import { secureMathRandom } from "./secureMathRandom.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { moderateContent, SAFE_RESPONSES, type ModerationResult } from "./content-guard.ts";
import { checkRateLimit, checkSessionLimit, type RateLimitResult } from "./rate-limiter.ts";
import { ComplianceLogger, detectJurisdiction } from "./compliance-logger.ts";
import { detectPromptInjection, validateOutput, detectAnomaly, INJECTION_RESPONSES } from "./prompt-shield.ts";
import { validateInput, parseRequestBody, validateHeaders, type ValidatedInput } from "./input-validator.ts";
import { createComplianceWriter } from "./compliance-store.ts";
import { createResponseSchema, getTierLimits, getPromptValidationRules, getEntityExtractionRules, type SpiralAIResponse } from "./ai-schema.ts";
import { redactPII } from "./pii-redactor.ts";
import { loadAspiralMindcore } from "./aspiralMindcoreLoader.ts";

// =============================================================================
// PHASE 4: FULL GUARDRAILS - Content Moderation, Rate Limiting, Compliance
// Enterprise-Grade Hardening with Durable Compliance Logging
// =============================================================================

import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/requireUser.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[spiral-ai] Missing required env vars");
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_CHAT_MODEL = Deno.env.get("GROQ_CHAT_MODEL") || "openai/gpt-oss-120b";
const GROQ_AI_URL = "https://api.groq.com/openai/v1/chat/completions";

// Production configuration
const AI_TIMEOUT_MS = 30000; // 30 second timeout for AI gateway
const ENABLE_DETAILED_ERRORS = Deno.env.get("ENABLE_DETAILED_ERRORS") === "true";

// Breakthrough Quality V2 feature flag (default: ON)
const BREAKTHROUGH_QUALITY_V2 = Deno.env.get("BREAKTHROUGH_QUALITY_V2") !== "false";

// Flush timeouts (ms)
const FLUSH_START_MS = 250;
const FLUSH_BLOCK_MS = 400;
const FLUSH_SUCCESS_MS = 500;

// =============================================================================
// BREAKTHROUGH QUALITY V2: Anti-generic validation
// =============================================================================

const BANNED_BREAKTHROUGH_PHRASES = [
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
 * Returns true if text contains banned generic motivational filler.
 * Exported for testing.
 */
export function isGenericBreakthroughText(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_BREAKTHROUGH_PHRASES.some(p => lower.includes(p));
}

/**
 * Returns true if a response has complete, non-empty, non-generic breakthrough fields.
 * Exported for testing.
 */
export function hasValidBreakthrough(data: SpiralAIResponse): boolean {
  return !!(
    data.friction?.trim() &&
    data.grease?.trim() &&
    data.insight?.trim() &&
    !isGenericBreakthroughText(data.friction) &&
    !isGenericBreakthroughText(data.grease) &&
    !isGenericBreakthroughText(data.insight)
  );
}

// =============================================================================
// CRYPTO HASHING - SHA-256 for identifier hashing
// =============================================================================

async function hashSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  // Return only first 16 chars for brevity while maintaining uniqueness
  return hashHex.substring(0, 16);
}

// =============================================================================
// VALIDATION WITH RETRY - AI Integrity Loop with Tier-Aware Schema
// =============================================================================

const MAX_VALIDATION_RETRIES = 2;

// Helper: Format validation error messages
function formatValidationErrors(error: Error): string {
  if ("errors" in error && Array.isArray((error as unknown as { errors: unknown[] }).errors)) {
    return ((error as unknown as { errors: Array<{ path: string[]; message: string }> }).errors)
      .map(e => `- ${e.path.join('.')}: ${e.message}`)
      .join('\n');
  }
  return error.message;
}

// Helper: Parse JSON from AI response content
function parseAIResponseContent(content: string): unknown | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  } catch {
    return null;
  }
}

// Helper: Create fallback response
function createFallbackResponse(shouldBreakthrough: boolean): SpiralAIResponse {
  return {
    entities: [],
    connections: [],
    question: shouldBreakthrough ? "" : "What's on your mind?",
    response: "I hear you.",
    friction: undefined,
    grease: undefined,
    insight: undefined,
  };
}

async function callAIWithValidation(
  systemPrompt: string,
  userContent: string,
  shouldBreakthrough: boolean,
  userTier: string,
  onBreakthroughRejected?: (info: { attempt: number; reason: string }) => void
): Promise<{ data: SpiralAIResponse; retryCount: number }> {
  const limits = getTierLimits(userTier);
  const ResponseSchema = createResponseSchema(limits);
  
  let lastError: Error | null = null;
  let retryCount = 0;

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    // Build prompt with validation feedback on retry
    const prompt = attempt > 0 && lastError
      ? `${systemPrompt}\n\n⚠️ VALIDATION FAILED ON PREVIOUS ATTEMPT:\n${formatValidationErrors(lastError)}\n\nPlease fix these issues and respond with valid JSON.`
      : systemPrompt;

    if (attempt > 0) {
      console.log(`[SPIRAL-AI] 🔄 Retry ${attempt}/${MAX_VALIDATION_RETRIES} with validation feedback`);
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(GROQ_AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_CHAT_MODEL,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    // Parse and validate response
    const parsed = parseAIResponseContent(content);
    if (parsed === null) {
      lastError = new Error("Invalid JSON response from AI");
      retryCount = attempt + 1;
      continue;
    }

    const result = ResponseSchema.safeParse(parsed);
    if (!result.success) {
      lastError = result.error;
      retryCount = attempt + 1;
      console.warn(`[SPIRAL-AI] ⚠️ Validation failed:`, result.error.errors.slice(0, 3));
      continue;
    }

    const validatedData = result.data as SpiralAIResponse;

    // V2: If breakthrough expected, check for generic/incomplete content
    if (BREAKTHROUGH_QUALITY_V2 && shouldBreakthrough) {
      if (!hasValidBreakthrough(validatedData)) {
        const rejectionReason = !validatedData.friction?.trim() || !validatedData.grease?.trim() || !validatedData.insight?.trim()
          ? 'empty_or_partial' : 'generic_phrase';
        console.warn(`[SPIRAL-AI] ⚠️ Breakthrough content is generic/incomplete on attempt ${attempt + 1} (${rejectionReason}) — retrying`);
        onBreakthroughRejected?.({ attempt: attempt + 1, reason: rejectionReason });
        lastError = new Error("Breakthrough content is generic or incomplete. Provide specific, personalized friction, grease, and insight based on the user's actual situation.");
        retryCount = attempt + 1;
        continue;
      }
    }

    console.log(`[SPIRAL-AI] ✅ Validation passed on attempt ${attempt + 1}`);
    return { data: validatedData, retryCount: attempt };
  }

  // All retries failed - return safe fallback (no fake breakthrough data)
  console.error(`[SPIRAL-AI] ❌ Validation failed after ${MAX_VALIDATION_RETRIES + 1} attempts`);
  return { data: createFallbackResponse(shouldBreakthrough), retryCount };
}

// =============================================================================
// PROMPTS & PATTERNS
// =============================================================================

const FRUSTRATION_PATTERNS = [
  /annoying/i, /stop/i, /enough/i, /just tell me/i, /wtf/i, /ffs/i,
  /come on/i, /seriously/i, /waste.*time/i, /dragging/i, /taking forever/i,
  /get to the point/i, /skip/i, /cut to/i, /what's the answer/i,
];

const MAX_QUESTIONS = 3;

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

interface RequestBody {
  transcript: string;
  userTier?: string;
  userId?: string;
  sessionId?: string;
  ultraFast?: boolean;
  sessionContext?: {
    entities?: Array<{ type: string; label: string }>;
    conversationHistory?: string[];
    questionsAsked?: number;
    stage?: "friction" | "desire" | "blocker" | "breakthrough";
    detectedPatterns?: Array<{ name: string; confidence: number }>;
  };
  forceBreakthrough?: boolean;
  stagePrompt?: string;
}

// =============================================================================
// GENERATE REQUEST ID
// =============================================================================

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${secureMathRandom().toString(36).substr(2, 9)}`;
}

// =============================================================================
// HELPER FUNCTIONS FOR ERROR RESPONSES
// =============================================================================

function createErrorResponse(
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>,
  additionalHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...additionalHeaders,
      },
    }
  );
}

function handleValidationError(errors: unknown[], corsHeaders: Record<string, string>): Response {
  return createErrorResponse(400, {
    error: "Invalid request format",
    details: (errors as Array<{ message: string }>)?.map((e) => e.message),
  }, corsHeaders);
}

function handleInjectionBlock(corsHeaders: Record<string, string>): Response {
  return createErrorResponse(200, {
    entities: [],
    connections: [],
    question: INJECTION_RESPONSES.BLOCKED.suggestion,
    response: INJECTION_RESPONSES.BLOCKED.message,
    blocked: true,
    category: "INJECTION_ATTEMPT",
  }, corsHeaders, { "X-Security-Block": "INJECTION" });
}

function handleAnomalyDetection(corsHeaders: Record<string, string>): Response {
  return createErrorResponse(429, {
    error: INJECTION_RESPONSES.RATE_ANOMALY.message,
    retryAfter: INJECTION_RESPONSES.RATE_ANOMALY.retryAfter,
  }, corsHeaders, { "Retry-After": "60" });
}

function handleRateLimit(rateLimitResult: RateLimitResult, corsHeaders: Record<string, string>): Response {
  return createErrorResponse(429, {
    error: SAFE_RESPONSES.RATE_LIMITED.message,
    retryAfter: rateLimitResult.retryAfterSeconds,
    upgradePrompt: rateLimitResult.upgradePrompt,
  }, corsHeaders, {
    "Retry-After": String(rateLimitResult.retryAfterSeconds || 60),
    "X-RateLimit-Limit": String(rateLimitResult.limits.requestsPerMinute),
    "X-RateLimit-Remaining": String(Math.max(0, rateLimitResult.limits.requestsPerMinute - rateLimitResult.currentUsage.minute)),
  });
}

function handleModerationBlock(moderationResult: ModerationResult, corsHeaders: Record<string, string>): Response {
  // Return appropriate safe response
  if (moderationResult.action === "REDIRECT_RESOURCES") {
    return createErrorResponse(200, {
      error: SAFE_RESPONSES.REDIRECT_CRISIS.message,
      resources: moderationResult.resources,
      blocked: true,
      category: "CRISIS_SUPPORT",
    }, corsHeaders);
  }

  let safeResponse = SAFE_RESPONSES.BLOCKED_GENERAL;
  if (moderationResult.category?.includes("VIOLENCE")) {
    safeResponse = SAFE_RESPONSES.BLOCKED_VIOLENCE;
  } else if (moderationResult.category?.includes("ILLEGAL") ||
             moderationResult.category?.includes("DRUG") ||
             moderationResult.category?.includes("CRIME")) {
    safeResponse = SAFE_RESPONSES.BLOCKED_ILLEGAL;
  }

  return createErrorResponse(200, {
    entities: [],
    connections: [],
    question: safeResponse.suggestion || "",
    response: safeResponse.message,
    blocked: true,
    category: moderationResult.category,
  }, corsHeaders, {
    "X-Content-Blocked": "true",
    "X-Block-Category": moderationResult.category || "POLICY_VIOLATION",
  });
}

function buildContextInfo(
  sessionContext: {
    entities?: Array<{ type: string; label: string }>;
    conversationHistory?: string[];
    detectedPatterns?: Array<{ name: string; confidence: number }>;
  } | undefined,
  stagePrompt: string | undefined,
  questionsAsked: number,
  shouldBreakthrough: boolean,
  maxQuestions: number
): string {
  let contextInfo = "";
  if (sessionContext?.entities?.length) {
    contextInfo += `\nExisting entities (don't duplicate): ${sessionContext.entities.map(e => e.label).join(", ")}`;
  }
  if (sessionContext?.conversationHistory?.length) {
    const sanitizedHistory = sessionContext.conversationHistory.map(h => redactPII(h).redacted);
    contextInfo += `\nConversation:\n${sanitizedHistory.slice(-4).join("\n")}`;
  }
  if (sessionContext?.detectedPatterns?.length) {
    contextInfo += `\nPatterns (use for insight): ${sessionContext.detectedPatterns.map(p => p.name).join(", ")}`;
  }
  if (stagePrompt && !shouldBreakthrough) {
    contextInfo += `\n\nSTAGE: ${stagePrompt}`;
  }
  if (questionsAsked === maxQuestions - 1 && !shouldBreakthrough) {
    contextInfo += `\n\n⚠️ LAST QUESTION - make it count.`;
  }
  return contextInfo;
}

// =============================================================================
// ERROR HANDLER
// =============================================================================

async function handleServeError(
  error: unknown,
  requestId: string,
  startTime: number,
  complianceLogger: ComplianceLogger,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const processingTime = Date.now() - startTime;
  const errorMessage = error instanceof Error ? error.message : "Unknown";
  console.error("[spiral-ai] Unhandled error:", error);
  console.error("[SPIRAL-AI] Error:", { requestId, error: errorMessage, processingMs: processingTime });

  await complianceLogger.finalizeRun({ 
    status: "ERROR", 
    errorCode: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "INTERNAL_ERROR",
    errorMessage: errorMessage.substring(0, 200),
  });
  await complianceLogger.flush(FLUSH_BLOCK_MS);

  if (error instanceof Error && error.name === "AbortError") {
    complianceLogger.log("ERROR_OCCURRED", { errorCode: "TIMEOUT", errorMessage: "AI gateway timeout" });
    return new Response(
      JSON.stringify({
        error: "Request timed out. Please try again.",
        requestId,
        entities: [],
        connections: [],
        question: "That took too long. Want to try again?",
        response: "",
      }),
      { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId } }
    );
  }

  if (error instanceof Error && error.message.includes("429")) {
    complianceLogger.log("ERROR_OCCURRED", { errorCode: "AI_RATE_LIMIT", errorMessage: "AI gateway rate limited" });
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again shortly.", requestId }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId, "Retry-After": "30" } }
    );
  }

  if (error instanceof Error && error.message.includes("402")) {
    complianceLogger.log("ERROR_OCCURRED", { errorCode: "QUOTA_EXCEEDED", errorMessage: "AI credits exhausted" });
    return new Response(
      JSON.stringify({ error: "AI credits exhausted. Please add credits.", requestId }),
      { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId } }
    );
  }

  if (error instanceof Error && (error.message.includes("fetch") || error.message.includes("network"))) {
    complianceLogger.log("ERROR_OCCURRED", { errorCode: "NETWORK_ERROR", errorMessage: "AI gateway unreachable" });
    return new Response(
      JSON.stringify({
        error: "Service temporarily unavailable. Please try again.",
        requestId,
        entities: [],
        connections: [],
        question: "Having trouble connecting. Try again?",
        response: "",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId, "Retry-After": "5" } }
    );
  }

  complianceLogger.log("ERROR_OCCURRED", { errorCode: "INTERNAL_ERROR", errorMessage: errorMessage });
  return new Response(
    JSON.stringify({
      error: "Internal server error",
      code: "SPIRAL_AI_UNHANDLED",
      requestId,
      entities: [],
      connections: [],
      question: "Something went wrong. Try again?",
      response: "",
    }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Request-Id": requestId } }
  );
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  const startTime = Date.now();
  const requestId = generateRequestId();
  
  // Detect jurisdiction for compliance
  const jurisdiction = detectJurisdiction(req);
  const complianceLogger = new ComplianceLogger(requestId, jurisdiction);
  
  // Attach durable writer if configured
  const writer = createComplianceWriter();
  complianceLogger.attachWriter(writer);
  
  const preflight = handleCorsPreFlight(req);
  if (preflight) return preflight;

  // Build origin-aware CORS headers for this request
  const corsHeaders = getCorsHeaders(req);

  // Authentication Gate: Prevent unauthenticated LLM credit drain
  const userOrResp = await requireUser(req, corsHeaders);
  if (userOrResp instanceof Response) return userOrResp;

  try {
    if (!GROQ_API_KEY) {
      console.error("[SPIRAL-AI] GROQ_API_KEY not configured");
      complianceLogger.log("ERROR_OCCURRED", { errorCode: "CONFIG_ERROR", errorMessage: "API key not configured" });
      throw new Error("API key not configured");
    }

    // =======================================================================
    // LAYER 0: REQUEST PARSING & HEADER VALIDATION
    // =======================================================================
    const headerValidation = validateHeaders(req);
    if (!headerValidation.valid) {
      console.warn("[SPIRAL-AI] ⚠️ Header validation warnings:", headerValidation.warnings);
      complianceLogger.log("HEADER_WARNING", { warnings: headerValidation.warnings });
    }

    const parseResult = await parseRequestBody(req, 50000);
    if (!parseResult.success) {
      console.error("[SPIRAL-AI] ❌ Request parsing failed:", parseResult.error);
      return new Response(
        JSON.stringify({ error: parseResult.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =======================================================================
    // LAYER 0.5: INPUT SCHEMA VALIDATION
    // =======================================================================
    const inputValidation = validateInput(parseResult.data);
    if (!inputValidation.success) {
      console.error("[SPIRAL-AI] ❌ Input validation failed:", inputValidation.errors);
      complianceLogger.log("VALIDATION_FAILED", { errors: inputValidation.errors });
      return handleValidationError(inputValidation.errors || [], corsHeaders);
    }

    const { 
      transcript, 
      sessionContext, 
      stagePrompt,
      ultraFast,
      userTier,
      userId,
      sessionId,
      forceBreakthrough,
      stream: streamRequested,
    } = inputValidation.data as ValidatedInput;
    
    // =======================================================================
    // COMPUTE STRONG HASHES (SHA-256) FOR IDENTIFIERS
    // =======================================================================
    const sessionHash = await hashSHA256(sessionId);
    const userHash = userId ? await hashSHA256(userId) : undefined;
    
    // Set context on compliance logger
    complianceLogger.setContext({
      sessionHash: `sha:${sessionHash}`,
      userHash: userHash ? `sha:${userHash}` : undefined,
      userTier,
    });
    
    complianceLogger.log("REQUEST_RECEIVED", {
      sessionHash: `sha:${sessionHash}`,
      contentLength: transcript.length,
    });

    // =======================================================================
    // CRITICAL: WRITE RUN START EARLY (before any LLM/network calls)
    // =======================================================================
    await complianceLogger.writeRunStart();
    await complianceLogger.flush(FLUSH_START_MS);

    // =======================================================================
    // LAYER 0.75: PROMPT INJECTION DETECTION
    // =======================================================================
    const injectionResult = detectPromptInjection(transcript, requestId);
    
    complianceLogger.log("INJECTION_CHECK", {
      riskScore: injectionResult.riskScore,
      threatCount: injectionResult.threats.length,
      blocked: !injectionResult.isSafe,
    });

    if (!injectionResult.isSafe) {
      console.warn(`[SPIRAL-AI] 🛡️ Prompt injection BLOCKED`, {
        requestId,
        riskScore: injectionResult.riskScore,
        threats: injectionResult.threats.slice(0, 3).map(t => t.category),
      });

      await complianceLogger.finalizeRun({ status: "BLOCKED", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      return handleInjectionBlock(corsHeaders);
    }

    // =======================================================================
    // LAYER 0.9: ANOMALY DETECTION
    // =======================================================================
    const anomalyResult = detectAnomaly(userId, injectionResult.fingerprint, transcript.length);
    
    if (anomalyResult.isAnomaly) {
      console.warn(`[SPIRAL-AI] 🔍 Anomaly detected: ${anomalyResult.reason}`, { userId });
      complianceLogger.log("ANOMALY_DETECTED", { reason: anomalyResult.reason });
      
      await complianceLogger.finalizeRun({ status: "BLOCKED", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      return handleAnomalyDetection(corsHeaders);
    }

    // =======================================================================
    // LAYER 1: RATE LIMITING - Multi-tier with abuse detection
    // =======================================================================
    const rateLimitResult = checkRateLimit(userId, userTier, transcript.length);
    
    complianceLogger.log("RATE_LIMIT_CHECK", {
      rateLimitStatus: rateLimitResult.allowed ? "ALLOWED" : "LIMITED",
      currentUsage: rateLimitResult.currentUsage,
    });
    
    if (!rateLimitResult.allowed) {
      console.warn(`[SPIRAL-AI] 🚫 Rate limited: ${rateLimitResult.reason}`, {
        userId,
        tier: userTier,
        usage: rateLimitResult.currentUsage,
      });

      await complianceLogger.finalizeRun({ status: "BLOCKED", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      return handleRateLimit(rateLimitResult, corsHeaders);
    }

    // =======================================================================
    // LAYER 2: SESSION PROMPT CAP - Per-session limits with upgrade hooks
    // =======================================================================
    const sessionLimitResult = checkSessionLimit(sessionId, userTier);
    
    if (!sessionLimitResult.allowed) {
      console.warn(`[SPIRAL-AI] 📊 Session limit reached`, {
        sessionId,
        count: sessionLimitResult.count,
        limit: sessionLimitResult.limit,
      });
      
      await complianceLogger.finalizeRun({ status: "BLOCKED", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      
      return new Response(
        JSON.stringify({
          error: SAFE_RESPONSES.QUOTA_EXCEEDED.message,
          upgradePrompt: sessionLimitResult.upgradePrompt,
          promptCount: sessionLimitResult.count,
          promptLimit: sessionLimitResult.limit,
        }),
        { 
          status: 402, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // =======================================================================
    // LAYER 3: CONTENT MODERATION - Multi-jurisdiction compliance
    // =======================================================================
    const moderationResult = moderateContent(transcript, requestId, jurisdiction);
    
    complianceLogger.log("CONTENT_MODERATED", {
      moderationDecision: moderationResult.auditLog.decision,
      moderationCategory: moderationResult.category,
      moderationSeverity: moderationResult.severity,
      contentHash: moderationResult.auditLog.contentHash,
    });
    
    if (!moderationResult.allowed) {
      console.warn(`[SPIRAL-AI] 🛡️ Content blocked: ${moderationResult.category}`, {
        requestId,
        severity: moderationResult.severity,
        action: moderationResult.action,
      });

      complianceLogger.log("BLOCKED_CONTENT", {
        moderationCategory: moderationResult.category,
        moderationSeverity: moderationResult.severity,
      });

      await complianceLogger.finalizeRun({ status: "BLOCKED", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      return handleModerationBlock(moderationResult, corsHeaders);
    }
    
    // =======================================================================
    // LAYER 4: PII REDACTION - Sanitize before sending to LLM
    // =======================================================================
    const { redacted: sanitizedTranscript, piiFound } = redactPII(transcript);
    
    if (piiFound.length > 0) {
      console.log("[SPIRAL-AI] 🔒 PII redacted:", piiFound.join(", "));
      complianceLogger.log("PII_REDACTED", {
        piiTypesFound: piiFound,
        containsPII: true,
      });
    }
    
    const questionsAsked = sessionContext?.questionsAsked || 0;
    const stage = sessionContext?.stage || "friction";

    // FRUSTRATION CHECK - immediate breakthrough
    const isFrustrated = FRUSTRATION_PATTERNS.some(p => p.test(sanitizedTranscript));
    if (isFrustrated) {
      console.log("[SPIRAL-AI] ⚠️ Frustration detected, forcing breakthrough");
    }

    // Determine if breakthrough
    const shouldBreakthrough = 
      forceBreakthrough || 
      isFrustrated || 
      ultraFast ||
      questionsAsked >= MAX_QUESTIONS;

    console.log("[SPIRAL-AI] Processing:", {
      stage,
      questionsAsked,
      shouldBreakthrough,
      isFrustrated,
      ultraFast,
      userTier,
      piiRedacted: piiFound.length > 0,
      breakthroughQualityV2: BREAKTHROUGH_QUALITY_V2,
      processingMs: Date.now() - startTime,
    });

    // Build context for user-content only (single system prompt source remains MindCore SSOT)
    const contextInfo = buildContextInfo(sessionContext, stagePrompt, questionsAsked, shouldBreakthrough, MAX_QUESTIONS);

    let mindcore;
    try {
      mindcore = await loadAspiralMindcore();
    } catch (error) {
      console.error("[SPIRAL-AI] ❌ MindCore load failed; disabling aSpiral agent initialization", {
        error: error instanceof Error ? error.message : String(error),
      });

      await complianceLogger.finalizeRun({ status: "ERROR", blocked: true });
      await complianceLogger.flush(FLUSH_BLOCK_MS);
      return new Response(
        JSON.stringify({ error: "aSpiral agent unavailable: prompt integrity check failed" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[SPIRAL-AI] MindCore prompt locked", {
      aspiral_prompt_version: mindcore.version,
      aspiral_prompt_sha256: mindcore.sha256,
    });

    const systemPrompt = `${mindcore.systemPrompt}

## OUTPUT FORMAT — MANDATORY

You MUST respond with a single valid JSON object. No markdown, no prose outside JSON.

${getEntityExtractionRules(userTier)}

${getPromptValidationRules(userTier)}

ENTITY TYPES: "problem" | "emotion" | "value" | "action" | "friction" | "grease"
ENTITY ROLES (optional): "external_irritant" | "internal_conflict" | "desire" | "fear" | "constraint" | "solution"
CONNECTION TYPES: "causes" | "blocks" | "enables" | "resolves" | "opposes"

REQUIRED JSON STRUCTURE:
{
  "entities": [{ "type": "...", "label": "...", "role": "...", "emotionalValence": 0.0, "importance": 0.0 }],
  "connections": [{ "from": 0, "to": 1, "type": "causes", "strength": 0.8 }],
  "question": "One compassionate open-ended question",
  "response": "Your warm, validating response to the person"${shouldBreakthrough ? `,
  "friction": "The specific tension or conflict the person is experiencing",
  "grease": "A concrete, personalized path forward based on what they shared",
  "insight": "A specific breakthrough insight connecting their friction to their values"` : ''}
}

"response" must be your warm, compassionate reply (as defined by MindCore).
"question" must be ONE open-ended question (per Iron Rule 4).
"entities" extract the key concepts from what the person shared.
${shouldBreakthrough ? '"friction", "grease", and "insight" must be SPECIFIC to this person\'s situation — never generic motivational filler.' : 'Do NOT include friction, grease, or insight fields unless breakthrough is requested.'}

Respond ONLY with the JSON object. No other text.`;

    // =======================================================================
    // PHASE 3: VALIDATED AI CALL - With schema validation and retry
    // =======================================================================
    const userContent = `${sanitizedTranscript}${contextInfo}`;
    let breakthroughRejected = false;
    const { data: validatedResult, retryCount } = await callAIWithValidation(
      systemPrompt,
      userContent,
      shouldBreakthrough,
      userTier,
      (info) => {
        complianceLogger.log("BREAKTHROUGH_REJECTED_ATTEMPT", {
          errorCode: `attempt_${info.attempt}`,
          errorMessage: info.reason,
        } as Partial<import("./compliance-logger.ts").ComplianceAuditLog>);
      }
    );

    // Track final breakthrough rejection after all retries exhausted
    if (BREAKTHROUGH_QUALITY_V2 && shouldBreakthrough && !hasValidBreakthrough(validatedResult)) {
      breakthroughRejected = true;
      const reason = !validatedResult.friction?.trim() || !validatedResult.grease?.trim() || !validatedResult.insight?.trim()
        ? 'empty_or_partial' : 'generic_phrase';
      complianceLogger.log("BREAKTHROUGH_REJECTED", {
        errorCode: reason,
        errorMessage: `retries=${retryCount} friction=${!!validatedResult.friction?.trim()} grease=${!!validatedResult.grease?.trim()} insight=${!!validatedResult.insight?.trim()}`,
      });
    }

    // Filter connections to only reference valid entity indices
    const validConnections = validatedResult.connections.filter(conn =>
      conn.from >= 0 &&
      conn.from < validatedResult.entities.length &&
      conn.to >= 0 &&
      conn.to < validatedResult.entities.length &&
      conn.strength > 0.5
    );

    // =======================================================================
    // LAYER 5: OUTPUT VALIDATION - Prevent System Prompt Leakage
    // =======================================================================
    const outputValidation = validateOutput(validatedResult.question || "");
    const responseValidation = validateOutput(validatedResult.response || "");
    const insightValidation = validatedResult.insight ? validateOutput(validatedResult.insight) : { safe: true, filtered: validatedResult.insight };
    
    // V2: Also validate friction and grease output
    const frictionValidation = validatedResult.friction ? validateOutput(validatedResult.friction) : { safe: true, filtered: validatedResult.friction };
    const greaseValidation = validatedResult.grease ? validateOutput(validatedResult.grease) : { safe: true, filtered: validatedResult.grease };

    const result = {
      ...validatedResult,
      connections: validConnections,
      question: shouldBreakthrough ? "" : (outputValidation.filtered || validatedResult.question),
      response: responseValidation.filtered || validatedResult.response,
      insight: insightValidation.filtered,
      friction: frictionValidation.filtered,
      grease: greaseValidation.filtered,
    };

    const processingTime = Date.now() - startTime;
    console.log("[SPIRAL-AI] ✅ Complete:", {
      entityCount: result.entities.length,
      hasQuestion: !!result.question,
      isBreakthrough: shouldBreakthrough,
      hasInsight: !!result.insight,
      hasFriction: !!result.friction,
      hasGrease: !!result.grease,
      validationRetries: retryCount,
      piiRedacted: piiFound.length > 0,
      outputFiltered: !outputValidation.safe || !responseValidation.safe || !frictionValidation.safe || !greaseValidation.safe,
      processingMs: processingTime,
    });

    // Finalize run as SUCCESS
    await complianceLogger.finalizeRun({ status: "SUCCESS" });
    await complianceLogger.flush(FLUSH_SUCCESS_MS);

    // =======================================================================
    // SSE STREAMING MODE
    // =======================================================================
    if (streamRequested && result.response) {
      const encoder = new TextEncoder();
      const responseText = result.response;
      const metadata = {
        entities: result.entities,
        connections: result.connections,
        question: result.question,
        friction: result.friction,
        grease: result.grease,
        insight: result.insight,
      };

      const stream = new ReadableStream({
        async start(controller) {
          // Stream response text in chunks
          const chunkSize = 4;
          for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            const event = `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(event));
          }

          // Send metadata as final event
          const metaEvent = `data: ${JSON.stringify({ type: "metadata", ...metadata })}\n\n`;
          controller.enqueue(encoder.encode(metaEvent));

          // Send done signal
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Processing-Time": `${processingTime}ms`,
          "X-Validation-Retries": `${retryCount}`,
        },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "X-Processing-Time": `${processingTime}ms`,
        "X-Validation-Retries": `${retryCount}`,
        "X-PII-Redacted": piiFound.length > 0 ? "true" : "false",
        "X-Output-Filtered": (!outputValidation.safe || !responseValidation.safe || !frictionValidation.safe || !greaseValidation.safe) ? "true" : "false",
        ...(breakthroughRejected ? { "X-Breakthrough-Rejected": "true" } : {}),
      },
    });
  } catch (error) {
    return await handleServeError(error, requestId, startTime, complianceLogger, corsHeaders);
  }
});
