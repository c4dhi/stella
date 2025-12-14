/**
 * AudioReactiveSiriOrb Component
 * Wraps SiriOrb with audio-reactive animations for face visualizations
 */

import React, { useMemo, useEffect, useState, useRef } from 'react';
import SiriOrb from './SiriOrb';

// Theme color mappings in oklch format for SiriOrb
export const SIRI_ORB_THEMES = {
  // Default - Violet/Blue/Cyan (matching landing page)
  default: {
    bg: "oklch(12% 0.02 280)",
    c1: "oklch(55% 0.25 295)", // Violet
    c2: "oklch(65% 0.18 230)", // Blue
    c3: "oklch(70% 0.15 200)", // Cyan
  },
  sphere: {
    bg: "oklch(12% 0.02 280)",
    c1: "oklch(55% 0.25 295)", // Violet
    c2: "oklch(65% 0.18 230)", // Blue
    c3: "oklch(70% 0.15 200)", // Cyan
  },
  // Galaxy - Deep purple/indigo/pink
  galaxy: {
    bg: "oklch(10% 0.03 290)",
    c1: "oklch(50% 0.25 300)", // Deep purple
    c2: "oklch(55% 0.22 275)", // Indigo
    c3: "oklch(65% 0.20 350)", // Pink
  },
  // Rainy - Slate/gray-blue/silver
  rainy: {
    bg: "oklch(20% 0.02 250)",
    c1: "oklch(60% 0.05 250)", // Slate blue
    c2: "oklch(55% 0.04 240)", // Gray-blue
    c3: "oklch(75% 0.02 250)", // Silver
  },
  // Snowy - Ice blue/white-blue/pale cyan
  snowy: {
    bg: "oklch(30% 0.02 240)",
    c1: "oklch(85% 0.05 220)", // Ice blue
    c2: "oklch(90% 0.03 230)", // White-blue
    c3: "oklch(80% 0.08 200)", // Pale cyan
  },
  // Christmas - Red/green/gold
  christmas: {
    bg: "oklch(15% 0.03 25)",
    c1: "oklch(55% 0.22 25)",  // Red
    c2: "oklch(55% 0.18 145)", // Green
    c3: "oklch(80% 0.15 85)",  // Gold
  },
  // Sunny - Orange/yellow/warm white
  sunny: {
    bg: "oklch(25% 0.05 70)",
    c1: "oklch(70% 0.18 55)",  // Orange
    c2: "oklch(85% 0.15 95)",  // Yellow
    c3: "oklch(92% 0.05 90)",  // Warm white
  },
} as const;

export type SiriOrbTheme = keyof typeof SIRI_ORB_THEMES;

interface AudioReactiveSiriOrbProps {
  audioLevel?: number;           // 0-1
  isRemoteSpeaking?: boolean;
  isUserSpeaking?: boolean;
  theme?: SiriOrbTheme;
  size?: number;
  className?: string;
}

const AudioReactiveSiriOrb: React.FC<AudioReactiveSiriOrbProps> = ({
  audioLevel = 0,
  isRemoteSpeaking = false,
  isUserSpeaking = false,
  theme = 'default',
  size = 280,
  className = '',
}) => {
  // Get colors from theme
  const colors = useMemo(() => {
    return SIRI_ORB_THEMES[theme] || SIRI_ORB_THEMES.default;
  }, [theme]);

  // Speaking state with hold time - prevents flickering when audio briefly stops
  const [isSpeakingHeld, setIsSpeakingHeld] = useState(false);
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SPEAKING_HOLD_MS = 600; // Hold speaking state for 600ms after isRemoteSpeaking becomes false

  // Smoothed speaking state for visual transitions
  const [smoothedSpeaking, setSmoothedSpeaking] = useState(0);

  // Smoothed audio level
  const [smoothedAudio, setSmoothedAudio] = useState(0);

  // Ref to hold current audio level for continuous animation loop
  const audioLevelRef = useRef(audioLevel);
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

  // Calculate scale - subtle but noticeable effect when speaking
  // With smoothedSpeaking=1 and smoothedAudio=0.7, this gives ~1.084 (8.4% larger)
  const audioScale = 1 + smoothedSpeaking * smoothedAudio * 0.12;

  // Dynamic glow intensity
  const glowIntensity = 1 + smoothedSpeaking * smoothedAudio * 0.4;
  const brightnessFilter = 1 + smoothedSpeaking * smoothedAudio * 0.15;

  // Glow sizes based on sphere size
  const baseGlowSize = size * 0.25;
  const outerGlowSize = size * 0.5;

  // Convert oklch to rgba-compatible format for glow effects
  // Using fixed colors that match the theme palette
  const glowColors = useMemo(() => {
    switch (theme) {
      case 'galaxy':
        return { primary: 'rgba(139, 92, 246, 0.5)', secondary: 'rgba(236, 72, 153, 0.3)' };
      case 'rainy':
        return { primary: 'rgba(148, 163, 184, 0.4)', secondary: 'rgba(100, 116, 139, 0.3)' };
      case 'snowy':
        return { primary: 'rgba(226, 232, 240, 0.5)', secondary: 'rgba(148, 163, 184, 0.3)' };
      case 'christmas':
        return { primary: 'rgba(220, 38, 38, 0.4)', secondary: 'rgba(34, 197, 94, 0.3)' };
      case 'sunny':
        return { primary: 'rgba(251, 191, 36, 0.5)', secondary: 'rgba(56, 189, 248, 0.3)' };
      default: // default and sphere
        return { primary: 'rgba(124, 58, 237, 0.5)', secondary: 'rgba(6, 182, 212, 0.3)' };
    }
  }, [theme]);

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: size,
        height: size,
      }}
    >
      {/* Outer glow layer - audio reactive */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${glowColors.primary} 0%, transparent 70%)`,
          filter: `blur(${baseGlowSize}px)`,
          transform: `scale(${1.2 * glowIntensity})`,
          opacity: 0.5 + smoothedSpeaking * smoothedAudio * 0.3,
          transition: 'opacity 0.2s ease-out',
        }}
      />

      {/* Secondary glow layer */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${glowColors.secondary} 0%, transparent 60%)`,
          filter: `blur(${outerGlowSize}px)`,
          transform: `scale(${1.4 * glowIntensity})`,
          opacity: 0.3 + smoothedSpeaking * smoothedAudio * 0.2,
          transition: 'opacity 0.2s ease-out',
        }}
      />

      {/* SiriOrb with audio-reactive transform */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `scale(${audioScale})`,
          filter: `brightness(${brightnessFilter})`,
          // No CSS transition since JS already smooths the values
        }}
      >
        <SiriOrb
          size={`${size}px`}
          colors={colors}
          animationDuration={20}
          className="w-full h-full"
        />
      </div>

      {/* Center glow overlay - appears when speaking */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${glowColors.primary} 0%, transparent 50%)`,
          opacity: smoothedSpeaking * (0.2 + smoothedAudio * 0.4),
          transition: 'opacity 0.15s ease-out',
        }}
      />
    </div>
  );
};

export default AudioReactiveSiriOrb;
