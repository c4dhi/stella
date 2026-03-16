/**
 * useMouthAnimation Hook
 * Drives mouth animation with two independent axes derived from audio:
 *   - openness (jaw drop): spring dynamics with overshoot for consonant snaps
 *   - spread (lip width): sustained audio → wide, transients → narrow
 */

import { useEffect, useRef } from 'react';
import { useMotionValue } from 'framer-motion';
import type { UseMouthAnimationOptions } from '../types';

export const useMouthAnimation = ({
  audioLevel,
  isRemoteSpeaking,
  emotion,
  smoothingFactor = 0.2
}: UseMouthAnimationOptions) => {
  const mouthOpenness = useMotionValue(0);
  const mouthSpread = useMotionValue(0.5); // 0 = narrow/rounded, 1 = wide spread
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Spring state for openness (jaw)
    let currentOpen = 0;
    let velocityOpen = 0;

    // Spread tracking
    let currentSpread = 0.5;
    let audioEMA = 0; // exponential moving average of audio
    let prevAudio = 0;

    const SPRING_STIFFNESS = 0.55;
    const SPRING_DAMPING = 0.65;
    const SPREAD_LERP = 0.12;

    // Noise gate: only silence below this (very low threshold)
    const GATE_THRESHOLD = 0.04;
    const GATE_RELEASE = 0.08;
    let gateOpen = 0;

    // Consonant closure detection
    let recentPeak = 0;
    const PEAK_DECAY = 0.94;
    const CLOSURE_DROP_RATIO = 0.3; // audio must drop to <30% of recent peak
    const CLOSURE_DURATION_MS = 55;
    const CLOSURE_MIN_INTERVAL_MS = 180;
    const CLOSURE_MIN_PEAK = 0.1;
    let closureUntil = 0;
    let lastClosureTime = 0;

    const tick = () => {
      const now = performance.now();
      const rawAudio = isRemoteSpeaking ? audioLevel : 0;

      // --- Noise gate ---
      if (rawAudio > GATE_THRESHOLD) {
        gateOpen = 1;
      } else {
        gateOpen = Math.max(0, gateOpen - GATE_RELEASE);
      }

      // Pass audio through with minimal suppression — just remove the noise floor
      const gatedAudio = gateOpen > 0.01
        ? Math.max(0, rawAudio - GATE_THRESHOLD) / (1 - GATE_THRESHOLD)
        : 0;

      // --- Consonant closure detection ---
      if (gatedAudio > recentPeak) {
        recentPeak = gatedAudio;
      } else {
        recentPeak *= PEAK_DECAY;
      }

      const inClosure = now < closureUntil;
      if (
        !inClosure &&
        recentPeak > CLOSURE_MIN_PEAK &&
        gatedAudio < recentPeak * CLOSURE_DROP_RATIO &&
        now - lastClosureTime > CLOSURE_MIN_INTERVAL_MS
      ) {
        closureUntil = now + CLOSURE_DURATION_MS;
        lastClosureTime = now;
        recentPeak = gatedAudio;
      }

      // --- Openness: damped spring ---
      const openTarget = (now < closureUntil) ? 0 : gatedAudio * gateOpen;
      const springForce = (openTarget - currentOpen) * SPRING_STIFFNESS;
      velocityOpen += springForce;
      velocityOpen *= SPRING_DAMPING;
      currentOpen += velocityOpen;
      // Clamp to prevent negative overshoot from looking broken
      currentOpen = Math.max(0, Math.min(1.1, currentOpen));

      // --- Spread: derived from audio characteristics ---
      // Track running average (slow EMA) to detect sustained vs transient audio
      audioEMA += (gatedAudio - audioEMA) * 0.04;

      // Audio velocity (how fast the level is changing)
      const audioVelocity = Math.abs(gatedAudio - prevAudio);
      prevAudio = gatedAudio;

      // Spread logic:
      //   - Sustained high audio (close to EMA, both high) → wide (vowels: "ah", "ee")
      //   - Rapid changes (high velocity) → narrow (plosives: "b", "p", "t")
      //   - Low/gated audio → neutral (0.5)
      let spreadTarget: number;
      if (!isRemoteSpeaking || gateOpen < 0.1) {
        spreadTarget = 0.5; // neutral when silent or gate closed
      } else {
        const sustain = Math.max(0, 1 - audioVelocity * 12);
        const loudness = Math.min(gatedAudio * 1.5, 1);
        spreadTarget = 0.3 + sustain * loudness * 0.6 - (1 - sustain) * 0.2;
        spreadTarget = Math.max(0.1, Math.min(1.0, spreadTarget));
      }

      currentSpread += (spreadTarget - currentSpread) * SPREAD_LERP;

      mouthOpenness.set(currentOpen);
      mouthSpread.set(currentSpread);

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [audioLevel, isRemoteSpeaking, smoothingFactor, mouthOpenness, mouthSpread]);

  return {
    mouthOpenness,
    mouthSpread
  };
};
