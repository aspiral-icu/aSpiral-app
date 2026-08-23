import { Component, type ReactNode, useMemo, useState, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { SpiralHeroSVG } from "./SpiralHeroSVG";

const EnhancedSpiralScene = lazy(() =>
  import("./3d/EnhancedSpiralScene").then((m) => ({ default: m.EnhancedSpiralScene }))
);

function parseEnvBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return defaultValue;
}

type ErrorBoundaryState = {
  hasError: boolean;
};

class WebGLErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function SpiralStage({ className }: { className?: string }) {
  const [webglFailed, setWebglFailed] = useState(false);

  const enableWebGL = useMemo(() => {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
    return parseEnvBoolean(env.VITE_ENABLE_WEBGL, true);
  }, []);

  const shouldUseWebGL = enableWebGL && !webglFailed;

  return (
    <div
      className={cn("absolute inset-0 z-0", className)}
      // Critical for touch devices: prevent browser gestures from stealing drag/pinch from camera controls.
      // (MDN touch-action)
      style={shouldUseWebGL ? { touchAction: "none" } : undefined}
    >
      {shouldUseWebGL ? (
        <WebGLErrorBoundary onError={() => setWebglFailed(true)}>
          <Suspense fallback={<SpiralHeroSVG />}>
            <EnhancedSpiralScene interactive />
          </Suspense>
        </WebGLErrorBoundary>
      ) : (
        <SpiralHeroSVG />
      )}
    </div>
  );
}
