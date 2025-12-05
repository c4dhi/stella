/**
 * ThemeSphere Component
 * Unified sphere visualization matching stella-landingpage style
 * with configurable colors for different themes
 */

import React, { useMemo, CSSProperties } from 'react';
import { motion } from 'framer-motion';

export interface SphereColors {
  // Primary accent color (top-left glow)
  primary: string;
  // Secondary accent color (bottom-right glow)
  secondary: string;
  // Tertiary accent color (bottom glow)
  tertiary: string;
  // Core color (center of sphere)
  core: string;
  // Outer glow color
  glow: string;
}

// Pre-defined color schemes for each theme
export const SPHERE_THEMES: Record<string, SphereColors> = {
  // Default/Sphere - Purple/Cyan from landing page
  default: {
    primary: 'rgba(124, 58, 237, 0.8)',    // Violet
    secondary: 'rgba(6, 182, 212, 0.6)',   // Cyan
    tertiary: 'rgba(59, 130, 246, 0.5)',   // Blue
    core: 'rgba(20, 20, 40, 1)',
    glow: 'rgba(124, 58, 237, 0.5)',
  },
  sphere: {
    primary: 'rgba(124, 58, 237, 0.8)',
    secondary: 'rgba(6, 182, 212, 0.6)',
    tertiary: 'rgba(59, 130, 246, 0.5)',
    core: 'rgba(20, 20, 40, 1)',
    glow: 'rgba(124, 58, 237, 0.5)',
  },
  // Galaxy - Deep purple/indigo
  galaxy: {
    primary: 'rgba(139, 92, 246, 0.8)',    // Purple
    secondary: 'rgba(99, 102, 241, 0.6)',  // Indigo
    tertiary: 'rgba(6, 182, 212, 0.5)',    // Cyan accent
    core: 'rgba(15, 15, 35, 1)',
    glow: 'rgba(139, 92, 246, 0.5)',
  },
  // Rainy - Slate/gray tones
  rainy: {
    primary: 'rgba(148, 163, 184, 0.7)',   // Slate-300
    secondary: 'rgba(100, 116, 139, 0.6)', // Slate-500
    tertiary: 'rgba(71, 85, 105, 0.5)',    // Slate-600
    core: 'rgba(30, 41, 59, 1)',           // Slate-800
    glow: 'rgba(100, 116, 139, 0.4)',
  },
  // Snowy - Light/icy tones
  snowy: {
    primary: 'rgba(226, 232, 240, 0.8)',   // Slate-200
    secondary: 'rgba(203, 213, 225, 0.7)', // Slate-300
    tertiary: 'rgba(148, 163, 184, 0.6)',  // Slate-400
    core: 'rgba(71, 85, 105, 1)',          // Slate-600
    glow: 'rgba(203, 213, 225, 0.5)',
  },
  // Christmas - Red/green/gold
  christmas: {
    primary: 'rgba(255, 215, 0, 0.7)',     // Gold
    secondary: 'rgba(220, 38, 38, 0.6)',   // Red
    tertiary: 'rgba(34, 197, 94, 0.5)',    // Green
    core: 'rgba(30, 20, 20, 1)',
    glow: 'rgba(220, 38, 38, 0.4)',
  },
  // Sunny - Cyan/sky blue
  sunny: {
    primary: 'rgba(56, 189, 248, 0.8)',    // Sky-400
    secondary: 'rgba(14, 165, 233, 0.6)',  // Sky-500
    tertiary: 'rgba(6, 182, 212, 0.5)',    // Cyan
    core: 'rgba(7, 89, 133, 1)',           // Sky-800
    glow: 'rgba(14, 165, 233, 0.5)',
  },
};

interface ThemeSphereProps {
  theme?: keyof typeof SPHERE_THEMES | SphereColors;
  size?: number;
  audioLevel?: number;
  isRemoteSpeaking?: boolean;
  className?: string;
}

const ThemeSphere: React.FC<ThemeSphereProps> = ({
  theme = 'default',
  size = 280,
  audioLevel = 0,
  isRemoteSpeaking = false,
  className = '',
}) => {
  // Get colors from theme
  const colors = useMemo(() => {
    if (typeof theme === 'string') {
      return SPHERE_THEMES[theme] || SPHERE_THEMES.default;
    }
    return theme;
  }, [theme]);

  // Calculate audio-reactive scale (more dramatic when speaking)
  const audioScale = useMemo(() => {
    if (!isRemoteSpeaking) return 1;
    // Scale from 1.0 to 1.15 based on audio level
    return 1 + audioLevel * 0.15;
  }, [audioLevel, isRemoteSpeaking]);

  // Calculate dynamic glow intensity based on audio level
  const glowIntensity = useMemo(() => {
    if (!isRemoteSpeaking) return 1;
    // Increase glow by up to 80% when speaking loudly
    return 1 + audioLevel * 0.8;
  }, [audioLevel, isRemoteSpeaking]);

  // Helper to boost color opacity
  const boostOpacity = (color: string, multiplier: number) => {
    return color.replace(/[\d.]+\)$/, (match) => {
      const opacity = Math.min(1, parseFloat(match) * multiplier);
      return `${opacity.toFixed(2)})`;
    });
  };

  // Build the sphere gradient style with dynamic glow
  const sphereStyle: CSSProperties = useMemo(() => {
    const baseGlowSize = size * 0.35;
    const outerGlowSize = size * 0.7;
    const dynamicGlowSize = baseGlowSize * glowIntensity;
    const dynamicOuterGlowSize = outerGlowSize * glowIntensity;

    return {
      width: size,
      height: size,
      background: `
        radial-gradient(circle at 30% 30%, ${isRemoteSpeaking ? boostOpacity(colors.primary, 1 + audioLevel * 0.3) : colors.primary} 0%, transparent 50%),
        radial-gradient(circle at 70% 60%, ${isRemoteSpeaking ? boostOpacity(colors.secondary, 1 + audioLevel * 0.3) : colors.secondary} 0%, transparent 40%),
        radial-gradient(circle at 50% 80%, ${isRemoteSpeaking ? boostOpacity(colors.tertiary, 1 + audioLevel * 0.3) : colors.tertiary} 0%, transparent 40%),
        radial-gradient(circle at 50% 50%, ${colors.core} 0%, rgba(10, 10, 20, 1) 100%)
      `,
      boxShadow: `
        0 0 ${dynamicGlowSize}px ${boostOpacity(colors.glow, glowIntensity)},
        0 0 ${dynamicOuterGlowSize}px ${boostOpacity(colors.secondary, 0.3 * glowIntensity)},
        inset 0 0 ${baseGlowSize}px rgba(0, 0, 0, 0.5),
        inset 0 -${size * 0.18}px ${baseGlowSize}px ${colors.primary.replace(/[\d.]+\)$/, '0.3)')}
      `,
      '--sphere-glow-color': colors.glow,
    };
  }, [colors, size, glowIntensity, isRemoteSpeaking, audioLevel]);

  return (
    <motion.div
      className={`relative rounded-full sphere-animated ${className}`}
      style={sphereStyle}
      animate={{
        scale: audioScale,
      }}
      transition={{
        duration: 0.1,
        ease: 'easeOut',
      }}
    >
      {/* Top-left highlight (reflection) */}
      <div
        className="absolute rounded-full"
        style={{
          top: '10%',
          left: '15%',
          width: '30%',
          height: '20%',
          background: 'radial-gradient(ellipse, rgba(255, 255, 255, 0.35) 0%, transparent 70%)',
          filter: 'blur(8px)',
        }}
      />

      {/* Secondary small highlight */}
      <div
        className="absolute rounded-full"
        style={{
          top: '18%',
          right: '22%',
          width: '12%',
          height: '8%',
          background: 'radial-gradient(ellipse, rgba(255, 255, 255, 0.25) 0%, transparent 70%)',
          filter: 'blur(4px)',
        }}
      />

      {/* Audio-reactive inner glow overlay */}
      {isRemoteSpeaking && (
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${colors.glow.replace(/[\d.]+\)$/, `${0.15 + audioLevel * 0.25})`)} 0%, transparent 60%)`,
          }}
          animate={{
            opacity: [0.7 + audioLevel * 0.3, 0.5 + audioLevel * 0.2, 0.7 + audioLevel * 0.3],
          }}
          transition={{
            duration: 0.15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}

      {/* Pulse rings when speaking */}
      {isRemoteSpeaking && (
        <>
          <motion.div
            className="absolute inset-0 rounded-full border"
            style={{
              borderColor: colors.glow,
            }}
            animate={{
              scale: [1, 1.3],
              opacity: [0.5, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border"
            style={{
              borderColor: colors.secondary.replace(/[\d.]+\)$/, '0.3)'),
            }}
            animate={{
              scale: [1, 1.5],
              opacity: [0.3, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeOut',
              delay: 0.5,
            }}
          />
        </>
      )}
    </motion.div>
  );
};

export default ThemeSphere;
