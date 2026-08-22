import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export function AuroraBackground() {
  const { isBreakthroughActive } = useSessionStore();

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Ambient Aurora Layer - enhanced with matching Landing aesthetics */}
      <motion.div
        className={cn(
          "absolute inset-0 opacity-40 mix-blend-screen",
          "aurora-ambient transition-all duration-3000",
          isBreakthroughActive && "aurora-breakthrough-active"
        )}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        transition={{ duration: 1.5 }}
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, 
              hsl(var(--primary) / 0.35), 
              transparent 50%
            ),
            radial-gradient(ellipse 60% 40% at 80% 50%, 
              hsl(var(--spiral-accent) / 0.25), 
              transparent 50%
            ),
            radial-gradient(ellipse 50% 30% at 20% 80%, 
              hsl(var(--secondary) / 0.3), 
              transparent 50%
            )
          `,
          filter: "blur(60px)",
        }}
      />

      {/* Additional flowing layer with dramatic glow */}
      <motion.div
        className="absolute inset-0 opacity-25 mix-blend-screen aurora-flow"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.25 }}
        transition={{ duration: 2, delay: 0.5 }}
        style={{
          background: `
            radial-gradient(ellipse 40% 60% at 30% 40%, 
              hsl(var(--spiral-glow) / 0.5), 
              transparent 60%
            ),
            radial-gradient(ellipse 50% 40% at 70% 60%, 
              hsl(var(--accent) / 0.4), 
              transparent 50%
            )
          `,
          filter: "blur(80px)",
        }}
      />

      {/* Ambient green aurora wash - always visible, luminous jade & emerald celestial ribbons */}
      <div
        className="absolute inset-0 mix-blend-screen aurora-green-ambient pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 85% 55% at 75% 20%,
              hsl(var(--aurora-green-1) / 0.85) 0%,
              hsl(var(--aurora-green-2) / 0.50) 35%,
              transparent 65%
            ),
            radial-gradient(ellipse 70% 45% at 20% 70%,
              hsl(var(--aurora-green-2) / 0.75) 0%,
              hsl(var(--aurora-green-3) / 0.40) 40%,
              transparent 65%
            ),
            radial-gradient(ellipse 60% 35% at 50% 5%,
              hsl(var(--aurora-green-3) / 0.65) 0%,
              transparent 55%
            )
          `,
          filter: "blur(50px)",
        }}
      />

      {/* Subtle pulsing glow layer - matches Landing heromark effect */}
      <motion.div
        className="absolute inset-0 opacity-15"
        animate={{
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: `
            radial-gradient(circle at 50% 50%, 
              hsl(var(--primary) / 0.3), 
              transparent 40%
            )
          `,
          filter: "blur(100px)",
        }}
      />
    </div>
  );
}
