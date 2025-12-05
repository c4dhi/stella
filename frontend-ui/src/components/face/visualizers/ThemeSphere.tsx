/**
 * ThemeSphere Component
 * Unified sphere visualization matching stella-landingpage style
 * with configurable colors for different themes and smooth animations
 */

import React, { useMemo, useEffect, useState } from 'react';

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
  // Brighter version for speaking state
  speakingPrimary: string;
  speakingSecondary: string;
  speakingGlow: string;
}

// Pre-defined color schemes for each theme
export const SPHERE_THEMES: Record<string, SphereColors> = {
  // Default/Sphere - Purple/Cyan from landing page
  default: {
    primary: 'rgba(124, 58, 237, 0.8)',
    secondary: 'rgba(6, 182, 212, 0.6)',
    tertiary: 'rgba(59, 130, 246, 0.5)',
    core: 'rgba(20, 20, 40, 1)',
    glow: 'rgba(124, 58, 237, 0.5)',
    speakingPrimary: 'rgba(167, 139, 250, 0.95)',
    speakingSecondary: 'rgba(34, 211, 238, 0.85)',
    speakingGlow: 'rgba(167, 139, 250, 0.7)',
  },
  sphere: {
    primary: 'rgba(124, 58, 237, 0.8)',
    secondary: 'rgba(6, 182, 212, 0.6)',
    tertiary: 'rgba(59, 130, 246, 0.5)',
    core: 'rgba(20, 20, 40, 1)',
    glow: 'rgba(124, 58, 237, 0.5)',
    speakingPrimary: 'rgba(167, 139, 250, 0.95)',
    speakingSecondary: 'rgba(34, 211, 238, 0.85)',
    speakingGlow: 'rgba(167, 139, 250, 0.7)',
  },
  // Galaxy - Deep purple/indigo
  galaxy: {
    primary: 'rgba(139, 92, 246, 0.8)',
    secondary: 'rgba(99, 102, 241, 0.6)',
    tertiary: 'rgba(6, 182, 212, 0.5)',
    core: 'rgba(15, 15, 35, 1)',
    glow: 'rgba(139, 92, 246, 0.5)',
    speakingPrimary: 'rgba(196, 181, 253, 0.95)',
    speakingSecondary: 'rgba(165, 180, 252, 0.85)',
    speakingGlow: 'rgba(196, 181, 253, 0.7)',
  },
  // Rainy - Slate/gray tones
  rainy: {
    primary: 'rgba(148, 163, 184, 0.7)',
    secondary: 'rgba(100, 116, 139, 0.6)',
    tertiary: 'rgba(71, 85, 105, 0.5)',
    core: 'rgba(30, 41, 59, 1)',
    glow: 'rgba(100, 116, 139, 0.4)',
    speakingPrimary: 'rgba(203, 213, 225, 0.9)',
    speakingSecondary: 'rgba(148, 163, 184, 0.85)',
    speakingGlow: 'rgba(203, 213, 225, 0.6)',
  },
  // Snowy - Light/icy tones
  snowy: {
    primary: 'rgba(226, 232, 240, 0.8)',
    secondary: 'rgba(203, 213, 225, 0.7)',
    tertiary: 'rgba(148, 163, 184, 0.6)',
    core: 'rgba(71, 85, 105, 1)',
    glow: 'rgba(203, 213, 225, 0.5)',
    speakingPrimary: 'rgba(248, 250, 252, 0.95)',
    speakingSecondary: 'rgba(241, 245, 249, 0.9)',
    speakingGlow: 'rgba(248, 250, 252, 0.7)',
  },
  // Christmas - Red/green/gold
  christmas: {
    primary: 'rgba(255, 215, 0, 0.7)',
    secondary: 'rgba(220, 38, 38, 0.6)',
    tertiary: 'rgba(34, 197, 94, 0.5)',
    core: 'rgba(30, 20, 20, 1)',
    glow: 'rgba(220, 38, 38, 0.4)',
    speakingPrimary: 'rgba(255, 235, 59, 0.95)',
    speakingSecondary: 'rgba(248, 113, 113, 0.85)',
    speakingGlow: 'rgba(255, 235, 59, 0.7)',
  },
  // Sunny - Cyan/sky blue
  sunny: {
    primary: 'rgba(56, 189, 248, 0.8)',
    secondary: 'rgba(14, 165, 233, 0.6)',
    tertiary: 'rgba(6, 182, 212, 0.5)',
    core: 'rgba(7, 89, 133, 1)',
    glow: 'rgba(14, 165, 233, 0.5)',
    speakingPrimary: 'rgba(125, 211, 252, 0.95)',
    speakingSecondary: 'rgba(56, 189, 248, 0.9)',
    speakingGlow: 'rgba(125, 211, 252, 0.7)',
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

  // Speaking state with hold time - prevents flickering when audio briefly stops
  const [isSpeakingHeld, setIsSpeakingHeld] = useState(false);
  const speakingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const SPEAKING_HOLD_MS = 600; // Hold speaking state for 600ms after isRemoteSpeaking becomes false

  // Smoothed speaking state for visual transitions
  const [smoothedSpeaking, setSmoothedSpeaking] = useState(0);

  // Smoothed audio level
  const [smoothedAudio, setSmoothedAudio] = useState(0);

  // Ref to hold current audio level for continuous animation loop
  const audioLevelRef = React.useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  // Handle speaking state with hold time
  useEffect(() => {
    if (isRemoteSpeaking) {
      // Clear any pending timeout and immediately enter speaking mode
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      setIsSpeakingHeld(true);
    } else {
      // Delay exit from speaking mode
      speakingTimeoutRef.current = setTimeout(() => {
        setIsSpeakingHeld(false);
      }, SPEAKING_HOLD_MS);
    }

    return () => {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
    };
  }, [isRemoteSpeaking]);

  // Smooth the speaking state transition (0 = idle, 1 = speaking)
  useEffect(() => {
    const targetValue = isSpeakingHeld ? 1 : 0;

    const animate = () => {
      setSmoothedSpeaking(prev => {
        const diff = targetValue - prev;
        if (Math.abs(diff) < 0.01) return targetValue;
        // Faster to enter (0.15), slower to exit (0.06) for smooth fade out
        const factor = targetValue > prev ? 0.15 : 0.06;
        return prev + diff * factor;
      });
    };

    const interval = setInterval(animate, 16);
    return () => clearInterval(interval);
  }, [isSpeakingHeld]);

  // Smooth audio level - continuous animation loop for fluid motion
  // Uses ref to always read latest audioLevel without restarting the loop
  useEffect(() => {
    let animationId: number;

    const animate = () => {
      setSmoothedAudio(prev => {
        const target = audioLevelRef.current;
        // Snappy response - fast attack AND decay for immediate start/stop feel
        // Attack (0.4) - very fast rise, Decay (0.2) - quick fade when audio stops
        const factor = target > prev ? 0.4 : 0.2;
        return prev + (target - prev) * factor;
      });
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []); // Empty deps - runs once, reads audioLevel from ref

  // Calculate scale - MUCH more visible effect when speaking
  // With smoothedSpeaking=1 and smoothedAudio=0.7, this gives ~1.175 (17.5% larger)
  const audioScale = 1 + smoothedSpeaking * smoothedAudio * 0.25;

  // Debug logging - remove after testing
  useEffect(() => {
    if (isRemoteSpeaking || audioLevel > 0.01) {
      console.log('[ThemeSphere]', {
        isRemoteSpeaking,
        audioLevel: audioLevel.toFixed(3),
        smoothedAudio: smoothedAudio.toFixed(3),
        smoothedSpeaking: smoothedSpeaking.toFixed(3),
        audioScale: audioScale.toFixed(3),
        isSpeakingHeld
      });
    }
  }, [isRemoteSpeaking, audioLevel, smoothedAudio, smoothedSpeaking, audioScale, isSpeakingHeld]);

  // Interpolate colors based on smoothed speaking state (not abrupt switch)
  const currentColors = useMemo(() => {
    // Always use base colors - the brightness/glow changes handle the speaking effect
    // This prevents jarring color switches
    return colors;
  }, [colors]);

  // Dynamic glow intensity - visible but not overwhelming
  const glowIntensity = 1 + smoothedSpeaking * smoothedAudio * 0.4;
  const brightnessFilter = 1 + smoothedSpeaking * smoothedAudio * 0.15;

  // Base glow sizes
  const baseGlowSize = size * 0.35;
  const outerGlowSize = size * 0.7;

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      {/* CSS for sphere animations - single consistent animation that doesn't change with state */}
      <style>{`
        @keyframes sphere-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }

        @keyframes sphere-glow-pulse {
          0%, 100% {
            filter: brightness(1);
          }
          50% {
            filter: brightness(1.03);
          }
        }

        @keyframes gradient-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes gradient-rotate-reverse {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }

        .sphere-container {
          animation: sphere-breathe 5s ease-in-out infinite, sphere-glow-pulse 7s ease-in-out infinite;
        }

        .gradient-layer-1 {
          animation: gradient-rotate 25s linear infinite;
        }

        .gradient-layer-2 {
          animation: gradient-rotate-reverse 30s linear infinite;
        }
      `}</style>

      {/* Outer wrapper for idle breathing animation */}
      <div className="absolute inset-0 sphere-container">
        {/* Inner sphere with audio-responsive transform */}
        <div
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{
            '--glow-color': colors.glow,
            background: `
              radial-gradient(circle at 50% 50%, ${currentColors.core} 0%, rgba(10, 10, 20, 1) 100%)
            `,
            boxShadow: `
              0 0 ${baseGlowSize * glowIntensity}px ${currentColors.glow},
              0 0 ${outerGlowSize * glowIntensity}px ${currentColors.secondary.replace(/[\d.]+\)$/, `${0.3 * glowIntensity})`)},
              inset 0 0 ${baseGlowSize}px rgba(0, 0, 0, 0.5),
              inset 0 -${size * 0.18}px ${baseGlowSize}px ${currentColors.primary.replace(/[\d.]+\)$/, '0.3)')}
            `,
            filter: `brightness(${brightnessFilter})`,
            // Audio-responsive transform - adds to the breathing animation
            transform: `scale(${audioScale})`,
            transition: 'transform 0.15s ease-out, box-shadow 0.25s ease-out, filter 0.25s ease-out',
          } as React.CSSProperties}
        >
        {/* Rotating gradient layer 1 - Primary color - always rotates */}
        <div
          className="absolute inset-0 rounded-full gradient-layer-1"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${currentColors.primary} 0%, transparent 50%)`,
            opacity: 0.7 + smoothedSpeaking * smoothedAudio * 0.25,
            transition: 'opacity 0.4s ease-out',
          }}
        />

        {/* Rotating gradient layer 2 - Secondary color - always rotates */}
        <div
          className="absolute inset-0 rounded-full gradient-layer-2"
          style={{
            background: `radial-gradient(circle at 70% 60%, ${currentColors.secondary} 0%, transparent 40%)`,
            opacity: 0.6 + smoothedSpeaking * smoothedAudio * 0.3,
            transition: 'opacity 0.4s ease-out',
          }}
        />

        {/* Static gradient layer 3 - Tertiary color */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 50% 80%, ${currentColors.tertiary} 0%, transparent 40%)`,
            opacity: 0.5 + smoothedSpeaking * smoothedAudio * 0.25,
            transition: 'opacity 0.4s ease-out',
          }}
        />

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

        {/* Center glow - always rendered, opacity controlled by smoothedSpeaking for smooth transitions */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${colors.speakingGlow || colors.glow} 0%, transparent 60%)`,
            opacity: smoothedSpeaking * (0.2 + smoothedAudio * 0.35),
            transition: 'opacity 0.4s ease-out',
          }}
        />
        </div>
      </div>
    </div>
  );
};

export default ThemeSphere;
