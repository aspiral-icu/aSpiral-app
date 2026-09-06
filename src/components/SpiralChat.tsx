 
import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Maximize2, Minimize2, SkipForward, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/ChatMessage";
import { MicButton } from "@/components/MicButton";
import { LiveTranscript } from "@/components/LiveTranscript";
import { QuestionBubble } from "@/components/QuestionBubble";
// Lazy load heavy 3D components
const SpiralStage = lazy(() => import("@/components/SpiralStage").then(module => ({ default: module.SpiralStage })));
const CinematicPlayer = lazy(() => import("@/components/cinematics/CinematicPlayer").then(module => ({ default: module.CinematicPlayer })));
import { BreakthroughCard } from "@/components/BreakthroughCard";
import { UltraFastToggle } from "@/components/UltraFastToggle";
import { LoadingState } from "@/components/LoadingState";
import { FloatingMenuButton, MainMenu, QuickActionsBar, SettingsPanel, KeyboardShortcutsModal } from "@/components/menu";
import { FilmGrainCSS } from "@/components/effects/FilmGrainOverlay";
import { EntityCardList } from "@/components/EntityCard";
import { EntityCounter } from "@/components/EntityCounter";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useSpiralAI } from "@/hooks/useSpiralAI";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import { useSessionStore } from "@/stores/sessionStore";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";
import { useAuth } from "@/contexts/AuthContext";
import { isProTier } from "@/lib/subscription";
import { BreakthroughPaywallModal } from "@/components/subscription/BreakthroughPaywallModal";
import { useKeyboardShortcuts, ASPIRAL_SHORTCUTS } from "@/hooks/useKeyboardShortcuts";
import { loadStoredSettings } from "@/lib/settings";
import { resolveVoiceProfile } from "@/lib/voiceProfile";
import type { Entity } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import { OmniLinkAdapter } from "@/integrations/omnilink";
import { createUpdateGuard } from "@/lib/updateGuard";
import { addBreadcrumb } from "@/lib/debugOverlay";
import { useRenderStormDetector } from "@/hooks/useRenderStormDetector";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export interface SpiralChatHandle {
  toggleRecording: () => void;
  openSettings: () => void;
}

 
interface SpiralChatProps { }

export const SpiralChat = forwardRef<SpiralChatHandle, SpiralChatProps>((_, ref) => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [input, setInput] = useState("");
  const [is3DExpanded, setIs3DExpanded] = useState(() =>
    typeof globalThis.window !== "undefined" ? globalThis.window.matchMedia("(min-width: 1024px)").matches : true
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // CRITICAL FIX: Ref to track last spoken question to prevent TTS loops
  const lastSpokenQuestionRef = useRef<string | null>(null);
  // Track last spoken assistant message ID to prevent TTS loops on typed chat
  const lastSpokenMsgIdRef = useRef<string | null>(null);
  const { toast } = useToast();

  const { canInstall, install: handleInstallPwa } = usePwaInstall();

  useRenderStormDetector('SpiralChat');

  // Session persistence
  const {
    save: saveSession,
    isSaving,
  } = useSessionPersistence();

  // Analytics tracking
  const {
    trackFeature,
    trackEntity,
    trackBreakthrough: trackBreakthroughEvent
  } = useAnalytics();

  const {
    createSession,
    currentSession,
    messages,
    addMessage,
  } = useSessionStore();

  const {
    isProcessing: isAIProcessing,
    processingStage,
    currentQuestion,
    currentStage,
    questionCount,
    maxQuestions,
    breakthroughData,
    showBreakthroughCard,
    ultraFastMode,
    processTranscript,
    accumulateTranscript,
    dismissQuestion,
    skipToBreakthrough,
    dismissBreakthroughCard,
    toggleUltraFastMode,
    resetSession,
    showCinematic,
    cinematicComplete,
    handleCinematicComplete,
    setShowCinematic,
    setCinematicComplete,
    flushTranscript,
  } = useSpiralAI({
    onEntitiesExtracted: (entities) => {
      // Track each entity creation
      entities.forEach((entity, index) => {
        trackEntity(
          `entity_${Date.now()}_${index}`,
          entity.type,
          currentSession?.entities.length || 0 + index + 1,
          'ai_extracted'
        );
      });

      toast({
        title: "Entities Discovered",
        description: `Found ${entities.length} new ${entities.length === 1 ? 'element' : 'elements'} in your story`,
      });
    },
    onQuestion: (question, stage) => {
      // Question triggered
    },
    onPatternDetected: (patterns) => {
      if (patterns.length > 0 && patterns[0].confidence > 0.7) {
        toast({
          title: "Pattern Detected",
          description: `I see a "${patterns[0].name.replace(/-/g, ' ')}" pattern...`,
        });
      }
    },
    onBreakthrough: (data) => {
      // Track breakthrough event
      if (data) {
        trackBreakthroughEvent(
          data.friction,
          data.grease,
          data.insight,
          questionCount,
          ultraFastMode
        );
      }

      toast({
        title: "✨ BREAKTHROUGH",
        description: data?.insight || "You've reached clarity!",
      });
    },
    onError: (error) => {
      toast({
        title: "Connection Issue",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [liveTranscript, setLiveTranscript] = useState("");
  const liveTranscriptGuard = useMemo(
    () => createUpdateGuard({ name: "SpiralChat.setLiveTranscript" }),
    []
  );
  const [ttsEnabled, setTtsEnabled] = useState(true); // User can toggle TTS

  const [voiceProfile, setVoiceProfile] = useState(() => {
    const stored = loadStoredSettings();
    return resolveVoiceProfile(stored ?? {});
  });

  useEffect(() => {
    const refreshVoiceProfile = () => {
      const stored = loadStoredSettings();
      setVoiceProfile(resolveVoiceProfile(stored ?? {}));
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'aspiral_settings_v1') {
        refreshVoiceProfile();
      }
    };

    globalThis.addEventListener('storage', onStorage);
    return () => globalThis.removeEventListener('storage', onStorage);
  }, []);

  // Stable TTS error handler to prevent speak callback recreation every render
  const handleTTSError = useCallback((error: Error) => {
    console.warn('[TTS] Error:', error.message);
  }, []);

  // Text-to-Speech for AI responses
  const {
    speak: speakText,
    isSpeaking: isTTSSpeaking,
    isLoading: isTTSLoading,
  } = useTextToSpeech({
    voice: voiceProfile.voice,
    speed: voiceProfile.speed,
    volume: voiceProfile.volume,
    fallbackToWebSpeech: true,
    onError: handleTTSError,
  });

  const {
    isRecording,
    isSupported,
    isPaused: isRecordingPaused,
    voiceState,
    transcript,
    finalTranscript,
    toggleRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    togglePause: toggleRecordingPause,
  } = useVoiceInput({
    onTranscript: (text) => {
      accumulateTranscript(text);
    },
  });

  const isVoiceRecovering = voiceState === 'Reconnecting';
  const isVoiceError = voiceState === 'Error';

  // CRITICAL FIX: Prevent TTS loop by tracking last spoken question
  // Only speak if the question has actually CHANGED since the last time we spoke
  useEffect(() => {
    if (
      currentQuestion &&
      ttsEnabled &&
      !isTTSSpeaking &&
      !isTTSLoading &&
      currentQuestion !== lastSpokenQuestionRef.current
    ) {
      lastSpokenQuestionRef.current = currentQuestion;
      speakText(currentQuestion);
    }
  }, [currentQuestion, ttsEnabled, isTTSSpeaking, isTTSLoading, speakText]);

  // Reset tracking when question is dismissed or cleared
  useEffect(() => {
    if (!currentQuestion) {
      lastSpokenQuestionRef.current = null;
    }
  }, [currentQuestion]);

  // Speak latest assistant chat message when TTS is enabled
  useEffect(() => {
    // Performance Optimization: Use a reverse loop instead of .filter().pop()
    // to find the last assistant message without intermediate array allocations
    let latest;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        latest = messages[i];
        break;
      }
    }

    if (
      latest &&
      ttsEnabled &&
      !isTTSSpeaking &&
      !isTTSLoading &&
      !latest.isStreaming &&
      latest.content.trim() &&
      latest.id !== lastSpokenMsgIdRef.current
    ) {
      lastSpokenMsgIdRef.current = latest.id;
      speakText(latest.content);
    }
  }, [messages, ttsEnabled, isTTSSpeaking, isTTSLoading, speakText]);

  // Surface voice error state to user
  useEffect(() => {
    if (isVoiceError) {
      toast({
        title: 'Microphone stalled',
        description: 'Tap the mic to restart voice input.',
        variant: 'destructive',
      });
    }
  }, [isVoiceError, toast]);

  // Submit finalTranscript on recording stop (zero-loss capture)
  const prevIsRecordingRef = useRef(false);
  useEffect(() => {
    const wasRecording = prevIsRecordingRef.current;
    prevIsRecordingRef.current = isRecording;
    if (wasRecording && !isRecording && finalTranscript.trim()) {
      accumulateTranscript(finalTranscript.trim());
    }
  }, [isRecording, finalTranscript, accumulateTranscript]);

  // Update live transcript display
  useEffect(() => {
    liveTranscriptGuard();
    setLiveTranscript(transcript);
  }, [transcript, liveTranscriptGuard]);

  // Initialize session on mount with user ID if authenticated
  useEffect(() => {
    if (!currentSession) {
      const userId = user?.id || "anonymous";
      const session = createSession(userId);
      OmniLinkAdapter.publishSessionStarted(session.id, session.userId);
    }
  }, [currentSession, createSession, user]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // When recording stops, send buffer
  useEffect(() => {
    if (!isRecording && !isRecordingPaused && liveTranscript) {
      flushTranscript(liveTranscript);
      setLiveTranscript("");
    }
  }, [isRecording, isRecordingPaused, liveTranscript, flushTranscript]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isAIProcessing) {
      addMessage({
        role: "user",
        content: input.trim(),
      });
      processTranscript(input.trim());
      setInput("");
      dismissQuestion();
    }
  };

  const handleMicToggle = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      trackFeature('voice_input');
      dismissQuestion();
      toggleRecording();
    }
  }, [isRecording, stopRecording, trackFeature, dismissQuestion, toggleRecording]);

  useImperativeHandle(ref, () => ({
    toggleRecording: handleMicToggle,
    openSettings: () => {
      trackFeature('settings_opened');
      addBreadcrumb({ type: 'settings', message: 'open' });
      setIsSettingsOpen(true);
    },
  }), [handleMicToggle, trackFeature]);

  const handleNewSession = useCallback(() => {
    resetSession();
    useSessionStore.getState().reset();
    dismissBreakthroughCard();
    setSessionElapsed(0);
    if (isRecording) {
      stopRecording();
    }

    // Reset cinematic state
    setShowCinematic(false);
    setCinematicComplete(false);
  }, [resetSession, dismissBreakthroughCard, isRecording, stopRecording, setShowCinematic, setCinematicComplete]);

  // Wrapped handlers with analytics
  const handleSkipToBreakthrough = useCallback(() => {
    trackFeature('skip_to_breakthrough');
    skipToBreakthrough();
  }, [skipToBreakthrough, trackFeature]);

  const handleToggleUltraFast = useCallback((enabled: boolean) => {
    trackFeature('ultra_fast_mode', { enabled });
    toggleUltraFastMode(enabled);
  }, [toggleUltraFastMode, trackFeature]);

  // Session timer - pauses when recording is paused or during breakthrough
  useEffect(() => {
    if (currentSession && !isRecordingPaused && currentStage !== "breakthrough") {
      const interval = setInterval(() => {
        setSessionElapsed((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentSession, isRecordingPaused, currentStage]);

  // Derive session state for menu
  const sessionState = currentSession
    ? currentStage === "breakthrough" || showBreakthroughCard
      ? "breakthrough"
      : isRecordingPaused
        ? "paused"
        : "active"
    : "idle";

  // Menu handlers - now tied to recording pause
  const handlePause = useCallback(() => {
    if (isRecording && !isRecordingPaused) {
      pauseRecording();
    }
  }, [isRecording, isRecordingPaused, pauseRecording]);

  const handleResume = useCallback(() => {
    if (isRecordingPaused) {
      resumeRecording();
    }
  }, [isRecordingPaused, resumeRecording]);

  const handleStop = useCallback(() => {
    handleNewSession();
    toast({ title: "Session Stopped", description: "Your session has been ended." });
  }, [handleNewSession, toast]);

  const handleSave = useCallback(async () => {
    trackFeature('session_saved');
    await saveSession();
    toast({
      title: "Progress Saved",
      description: isSaving ? "Saving..." : "Your session has been saved."
    });
  }, [saveSession, isSaving, toast, trackFeature]);

  const handleExport = useCallback(() => {
    if (breakthroughData) {
      trackFeature('session_exported');
      const content = `# ASPIRAL Breakthrough\n\n## Friction\n${breakthroughData.friction}\n\n## Grease\n${breakthroughData.grease}\n\n## Insight\n${breakthroughData.insight}`;
      navigator.clipboard.writeText(content);
      toast({ title: "Exported", description: "Breakthrough copied to clipboard!" });
    }
  }, [breakthroughData, toast, trackFeature]);

  const handleViewHistory = useCallback(() => {
    navigate('/sessions');
  }, [navigate]);

  const handleSettings = useCallback(() => {
    trackFeature('settings_opened');
    addBreadcrumb({ type: 'settings', message: 'open' });
    setIsSettingsOpen(true);
  }, [trackFeature]);

  const handleHelp = useCallback(() => {
    toast({
      title: "How ASPIRAL Works",
      description: "Speak your thoughts, answer 2 questions, get your breakthrough insight.",
    });
  }, [toast]);

  const handleShowShortcuts = useCallback(() => {
    setIsShortcutsOpen(true);
  }, []);

  // Keyboard shortcuts
  const shortcuts = [
    { ...ASPIRAL_SHORTCUTS.toggleMenu, action: () => setIsMenuOpen((prev) => !prev), enabled: true },
    { ...ASPIRAL_SHORTCUTS.pauseResume, action: () => (isRecordingPaused ? handleResume() : handlePause()), enabled: sessionState === "active" || sessionState === "paused" },
    { ...ASPIRAL_SHORTCUTS.skipBreakthrough, action: handleSkipToBreakthrough, enabled: sessionState === "active" },
    { ...ASPIRAL_SHORTCUTS.save, action: handleSave, enabled: sessionState !== "idle" },
    { ...ASPIRAL_SHORTCUTS.stop, action: handleStop, enabled: sessionState !== "idle" },
    { ...ASPIRAL_SHORTCUTS.restart, action: handleNewSession, enabled: sessionState !== "idle" },
    { ...ASPIRAL_SHORTCUTS.export, action: handleExport, enabled: sessionState === "breakthrough" },
    { ...ASPIRAL_SHORTCUTS.history, action: handleViewHistory, enabled: true },
    { ...ASPIRAL_SHORTCUTS.settings, action: handleSettings, enabled: true },
    { ...ASPIRAL_SHORTCUTS.help, action: handleShowShortcuts, enabled: true },
  ];

  useKeyboardShortcuts(shortcuts);

  const [dismissedEntityIds, setDismissedEntityIds] = useState<Set<string>>(new Set());
  const visibleEntities = useMemo(
    () => (currentSession?.entities || []).filter(e => !dismissedEntityIds.has(e.id)),
    [currentSession?.entities, dismissedEntityIds]
  );
  const entityCount = visibleEntities.length;
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();

  const handleEntityClick = useCallback((entity: Entity) => {
    setSelectedEntityId((prev) => prev === entity.id ? undefined : entity.id);
  }, []);

  const handleDismissEntity = useCallback((entity: Entity) => {
    setDismissedEntityIds(prev => new Set(prev).add(entity.id));
    if (selectedEntityId === entity.id) setSelectedEntityId(undefined);
  }, [selectedEntityId]);

  const handleClearAllEntities = useCallback(() => {
    const allIds = new Set((currentSession?.entities || []).map(e => e.id));
    setDismissedEntityIds(allIds);
    setSelectedEntityId(undefined);
  }, [currentSession?.entities]);

  const hasActiveHeader = sessionState !== "idle";

  return (
    <LayoutGroup>
      <div className={cn(
        "flex flex-col lg:flex-row relative",
        hasActiveHeader
          ? "h-[calc(100dvh-73px-52px)] mt-[52px] pb-16 lg:pb-0"
          : "h-[calc(100dvh-73px)] pb-16 lg:pb-0"
      )}>
        {/* Phase 4: Film Grain Overlay for Cinematic Polish */}
        <FilmGrainCSS intensity={0.08} />
        {/* Floating Menu Button */}
        <FloatingMenuButton
          sessionState={sessionState}
          onMenuOpen={() => setIsMenuOpen(true)}
        />

        {/* Main Menu Panel */}
        <MainMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          sessionState={sessionState}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onRestart={handleNewSession}
          onSkipToBreakthrough={handleSkipToBreakthrough}
          onSave={handleSave}
          onExport={handleExport}
          onViewHistory={handleViewHistory}
          onSettings={handleSettings}
          onHelp={handleHelp}
          installPwa={canInstall ? handleInstallPwa : undefined}
          sessionProgress={
            sessionState !== "idle"
              ? {
                questionCount,
                entityCount,
                timeElapsed: sessionElapsed,
              }
              : undefined
          }
        />

        {/* Quick Actions Header Bar */}
        <QuickActionsBar
          sessionState={sessionState}
          questionCount={questionCount}
          maxQuestions={maxQuestions}
          timeElapsed={sessionElapsed}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onSkip={handleSkipToBreakthrough}
          onSave={handleSave}
        />

        {/* Settings Panel */}
        <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

        {/* Loading State Overlay */}
        <AnimatePresence>
          {processingStage && <LoadingState stage={processingStage} />}
        </AnimatePresence>

        {/* Phase 2: Subscription Gating on Cinematic Breakthrough */}
        {showCinematic && !cinematicComplete && isProTier(profile?.tier) && (
          <Suspense fallback={null}>
            <CinematicPlayer
              variant={undefined} // Random variant selection
              onComplete={handleCinematicComplete}
              onSkip={handleCinematicComplete}
              allowSkip={true}
              autoPlay={true}
              enableAnalytics={true}
              className="z-[200]"
            />
          </Suspense>
        )}

        {/* Phase 2: Paywall Gate Modal for Free Users */}
        <BreakthroughPaywallModal
          isOpen={showCinematic && !cinematicComplete && !isProTier(profile?.tier)}
          onClose={handleCinematicComplete}
          onUpgradeSuccess={() => {
            // Upgrade will automatically make isProTier true on profile update
          }}
          onContinueTextOnly={handleCinematicComplete}
        />

        {/* Breakthrough Overlay Card */}
        <BreakthroughCard
          data={breakthroughData}
          isVisible={showBreakthroughCard && cinematicComplete}
          onDismiss={() => {
            dismissBreakthroughCard();
            setShowCinematic(false);
            setCinematicComplete(false);
          }}
          onNewSession={handleNewSession}
        />

        {/* Visual Spiral Panel (WebGL stage with safe SVG fallback) */}
        <div
          className={cn(
            "relative border-b lg:border-b-0 lg:border-r border-border/30 transition-all duration-500 flex-shrink-0",
            is3DExpanded
              ? "h-[40vh] sm:h-[50vh] lg:h-full lg:w-2/3"
              : "h-32 sm:h-48 lg:h-full lg:w-1/3"
          )}
        >
          {is3DExpanded ? (
            <Suspense fallback={<div className="absolute inset-0 bg-background/50 backdrop-blur-sm transition-colors duration-500" />}>
              <SpiralStage />
            </Suspense>
          ) : (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm transition-colors duration-500" />
          )}

          {/* Question Bubble - positioned in 3D area */}
          <QuestionBubble
            question={currentQuestion || ""}
            isVisible={!!currentQuestion && !isRecording}
            onAnswer={() => dismissQuestion()}
            questionNumber={questionCount + 1}
            totalQuestions={maxQuestions}
          />

          {/* Skip to Breakthrough Button - shows when there's a question */}
          {/* Positioned at top-left of 3D area to avoid overlapping QuestionBubble */}
          {currentQuestion && !isRecording && currentStage !== "breakthrough" && (
            <div className="absolute top-3 left-3 z-20 pointer-events-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkipToBreakthrough}
                aria-label={`Skip to breakthrough, currently on question ${questionCount + 1} of ${maxQuestions}`}
                className="glass-card rounded-xl text-xs text-secondary hover:text-secondary hover:bg-secondary/10 animate-in fade-in-0 slide-in-from-top-2 touch-manipulation"
              >
                <SkipForward className="h-3 w-3 mr-1.5" aria-hidden="true" />
                Skip ({questionCount + 1}/{maxQuestions})
              </Button>
            </div>
          )}

          {/* Expand/Collapse Button - positioned left of FloatingMenuButton on mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-14 sm:top-3 sm:right-3 z-10 glass-card rounded-xl touch-manipulation"
            onClick={() => setIs3DExpanded(!is3DExpanded)}
          >
            {is3DExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>

          {/* Entity Counter & Controls - hide when question is active to prevent obstruction */}
          <div className={cn(
            "absolute bottom-3 left-3 flex flex-wrap gap-2 z-10 transition-opacity duration-300",
            currentQuestion && "opacity-0 pointer-events-none"
          )}>
            {/* Ultra-fast mode toggle */}
            <UltraFastToggle
              isEnabled={ultraFastMode}
              onToggle={handleToggleUltraFast}
            />

            {entityCount > 0 && (
              <EntityCounter count={entityCount} />
            )}

          </div>
        </div>

        {/* Chat Panel */}
        <div className="flex-1 flex flex-col bg-background/50 backdrop-blur-md min-h-0 overflow-hidden">
          {/* Chat Header */}
          {hasActiveHeader && (
            <div className="border-b border-border/30 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Session in progress</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTtsEnabled(!ttsEnabled);
                  }}
                  className="text-xs"
                >
                  {ttsEnabled ? (
                    <Volume2 className="h-4 w-4 mr-1" />
                  ) : (
                    <VolumeX className="h-4 w-4 mr-1" />
                  )}
                  {ttsEnabled ? 'TTS On' : 'TTS Off'}
                </Button>
              </div>
            </div>
          )}

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full min-h-[120px] flex items-center justify-center text-center px-6">
                <p className="text-sm text-muted-foreground">
                  Your reflections will appear here as you talk or type.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Live Transcript */}
          {isRecording && (
            <LiveTranscript transcript={liveTranscript} isRecording={isRecording} isProcessing={isAIProcessing} />
          )}

          {/* Input Area */}
          <form onSubmit={handleSubmit} className="p-4 border-t border-border/30">
            <div className="flex gap-2 items-center">
              <MicButton
                isRecording={isRecording}
                isPaused={isRecordingPaused}
                isProcessing={isAIProcessing || isVoiceRecovering}
                isSupported={isSupported}
                onClick={handleMicToggle}
                onPause={isRecording ? toggleRecordingPause : undefined}
                onStop={isRecording ? stopRecording : undefined}
              />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your thoughts..."
                className="flex-1"
                disabled={isAIProcessing}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isAIProcessing}
                className="bg-primary text-primary-foreground"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>

          {/* Entity Cards */}
          {visibleEntities.length > 0 && (
            <div className="flex-shrink-0 max-h-[20vh] lg:max-h-[25vh] overflow-y-auto border-t border-border/30">
              <EntityCardList
                entities={visibleEntities}
                selectedId={selectedEntityId}
                onEntityClick={handleEntityClick}
                onDismissEntity={handleDismissEntity}
                onClearAll={handleClearAllEntities}
              />
            </div>
          )}
        </div>
      </div>
    </LayoutGroup>
  );
});

SpiralChat.displayName = "SpiralChat";