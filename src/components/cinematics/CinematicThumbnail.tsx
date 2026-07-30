import { secureMathRandom } from '@/lib/secureMathRandom';
/**
 * Cinematic Thumbnail Preview Component
 * Displays animated preview thumbnails for each cinematic variant
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Sparkles, Zap, CircleDot, Binary, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CinematicVariant } from '@/lib/cinematics/types';

interface CinematicThumbnailProps {
  variant: CinematicVariant;
  displayName: string;
  duration: number;
  isSelected?: boolean;
  onClick?: () => void;
  className?: string;
}

const variantStyles: Record<CinematicVariant, {
  bgGradient: string;
  accentColor: string;
  icon: React.ElementType;
  particles: string[];
}> = {
  spiral_ascend: {
    bgGradient: 'from-emerald-900/80 via-emerald-800/60 to-black',
    accentColor: 'rgb(34 197 94)',
    icon: Sparkles,
    particles: ['#22c55e', '#10b981', '#34d399'],
  },
  particle_explosion: {
    bgGradient: 'from-amber-900/80 via-orange-800/60 to-black',
    accentColor: 'rgb(251 191 36)',
    icon: Zap,
    particles: ['#fbbf24', '#f59e0b', '#f97316', '#ef4444'],
  },
  portal_reveal: {
    bgGradient: 'from-violet-900/80 via-purple-800/60 to-black',
    accentColor: 'rgb(139 92 246)',
    icon: CircleDot,
    particles: ['#8b5cf6', '#a78bfa', '#c4b5fd'],
  },
  matrix_decode: {
    bgGradient: 'from-green-900/80 via-emerald-900/60 to-black',
    accentColor: 'rgb(34 197 94)',
    icon: Binary,
    particles: ['#22c55e', '#10b981', '#84cc16'],
  },
  space_warp: {
    bgGradient: 'from-indigo-900/80 via-purple-900/60 to-black',
    accentColor: 'rgb(139 92 246)',
    icon: Rocket,
    particles: ['#8b5cf6', '#a78bfa', '#ffffff'],
  },
};

// Animated particle component
const AnimatedParticle: React.FC<{
  color: string;
  delay: number;
  variant: CinematicVariant;
}> = ({ color, delay, variant }) => {
  const getAnimation = () => {
    switch (variant) {
      case 'spiral_ascend':
        return {
          y: [40, -40],
          x: [0, secureMathRandom() * 20 - 10],
          rotate: [0, 360],
          opacity: [0, 1, 0],
        };
      case 'particle_explosion':
        return {
          scale: [0, 1, 0.5],
          x: [0, (secureMathRandom() - 0.5) * 60],
          y: [0, (secureMathRandom() - 0.5) * 60],
          opacity: [1, 0.8, 0],
        };
      case 'portal_reveal':
        return {
          rotate: [0, 360],
          scale: [0.5, 1, 0.5],
          opacity: [0, 1, 0],
        };
      case 'matrix_decode':
        return {
          y: [-20, 60],
          opacity: [0, 1, 1, 0],
        };
      case 'space_warp':
        return {
          z: [100, 0],
          scale: [0.1, 1.5],
          opacity: [0, 1, 0],
        };
      default:
        return { opacity: [0, 1, 0] };
    }
  };

  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: secureMathRandom() * 4 + 2,
        height: secureMathRandom() * 4 + 2,
        backgroundColor: color,
        left: `${secureMathRandom() * 100}%`,
        top: `${secureMathRandom() * 100}%`,
        boxShadow: `0 0 6px ${color}`,
      }}
      initial={{ opacity: 0 }}
      animate={getAnimation()}
      transition={{
        duration: 2,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
};

export const CinematicThumbnail: React.FC<CinematicThumbnailProps> = ({
  variant = 'spiral_ascend',
  displayName,
  duration,
  isSelected = false,
  onClick,
  className,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const style = variantStyles[variant];
  const Icon = style.icon;

  return (
    <motion.div
      className={cn(
        'relative overflow-hidden rounded-xl cursor-pointer group',
        'border transition-all duration-300',
        isSelected
          ? 'border-primary ring-2 ring-primary/50'
          : 'border-border/50 hover:border-primary/50',
        className
      )}
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Background gradient */}
      <div className={cn('absolute inset-0 bg-gradient-to-br', style.bgGradient)} />

      {/* Animated particles */}
      <div className="absolute inset-0 overflow-hidden">
        {style.particles.map((color, i) =>
          Array.from({ length: 4 }).map((_, j) => (
            <AnimatedParticle
              key={`${i}-${j}`}
              color={color}
              delay={i * 0.3 + j * 0.2}
              variant={variant}
            />
          ))
        )}
      </div>

      {/* Glow effect on hover */}
      <motion.div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: `radial-gradient(circle at center, ${style.accentColor}20 0%, transparent 70%)`,
        }}
      />

      {/* Content */}
      <div className="relative z-10 p-4 h-32 flex flex-col justify-between">
        {/* Icon and play button */}
        <div className="flex items-start justify-between">
          <motion.div
            className="p-2 rounded-lg bg-black/30 backdrop-blur-sm"
            animate={isHovered ? { scale: 1.1 } : { scale: 1 }}
          >
            <Icon
              className="w-5 h-5"
              style={{ color: style.accentColor }}
            />
          </motion.div>

          <motion.div
            className="p-2 rounded-full bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
            whileHover={{ scale: 1.2 }}
          >
            <Play className="w-4 h-4 text-white fill-white" />
          </motion.div>
        </div>

        {/* Title and duration */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">
            {displayName}
          </h3>
          <p className="text-xs text-white/60">
            {(duration / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <motion.div
          className="absolute top-2 right-2 w-3 h-3 rounded-full"
          style={{ backgroundColor: style.accentColor }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        >
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: style.accentColor }}
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        </motion.div>
      )}

      {/* Border glow animation on selected */}
      {isSelected && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow: `0 0 20px ${style.accentColor}40, inset 0 0 20px ${style.accentColor}20`,
          }}
          animate={{
            boxShadow: [
              `0 0 20px ${style.accentColor}40, inset 0 0 20px ${style.accentColor}20`,
              `0 0 30px ${style.accentColor}60, inset 0 0 30px ${style.accentColor}30`,
              `0 0 20px ${style.accentColor}40, inset 0 0 20px ${style.accentColor}20`,
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
};

export default CinematicThumbnail;
