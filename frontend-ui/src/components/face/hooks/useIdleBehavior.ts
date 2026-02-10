/**
 * useIdleBehavior Hook
 * Single RAF loop for all idle/ambient animations:
 *   - Eye drift (organic wandering when no tracking)
 *   - Thinking state (eyes drift up-left after user stops speaking)
 *   - Anticipation flash (eye pop when agent starts speaking)
 *   - Listening nods (head oscillation while user speaks)
 *
 * Merges the previous useIdleAnimations + useAnticipation into one loop.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../../../store';

interface UseIdleBehaviorOptions {
  isUserSpeaking: boolean;
  isRemoteSpeaking: boolean;
  hasDetection: boolean;
}

interface IdleBehaviorState {
  driftX: number;
  driftY: number;
  thinkingOffsetX: number;
  thinkingOffsetY: number;
  thinkingEyebrowRaise: number;
  anticipationScale: number;
  listeningNodRotation: number;
}

export const useIdleBehavior = ({
  isUserSpeaking,
  isRemoteSpeaking,
  hasDetection
}: UseIdleBehaviorOptions) => {
  const stateRef = useRef<IdleBehaviorState>({
    driftX: 0,
    driftY: 0,
    thinkingOffsetX: 0,
    thinkingOffsetY: 0,
    thinkingEyebrowRaise: 0,
    anticipationScale: 1,
    listeningNodRotation: 0
  });

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(Date.now());

  // Snapshot refs — loop reads these without restarting
  const hasDetectionRef = useRef(hasDetection);
  const isUserSpeakingRef = useRef(isUserSpeaking);
  const isRemoteSpeakingRef = useRef(isRemoteSpeaking);
  hasDetectionRef.current = hasDetection;
  isUserSpeakingRef.current = isUserSpeaking;
  isRemoteSpeakingRef.current = isRemoteSpeaking;

  const isTTSPlaying = useStore((s) => s.isTTSPlaying);
  const isTTSPlayingRef = useRef(isTTSPlaying);
  isTTSPlayingRef.current = isTTSPlaying;

  useEffect(() => {
    const isMobile = typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent);
    const targetInterval = isMobile ? 1000 / 30 : 1000 / 60;
    let lastFrame = 0;

    // Drift state
    let smoothDriftX = 0;
    let smoothDriftY = 0;

    // Thinking state
    let smoothThinkingX = 0;
    let smoothThinkingY = 0;
    let smoothBrowRaise = 0;
    let userStoppedTime: number | null = null;
    let wasUserSpeaking = false;

    // Anticipation flash
    let anticipationFlash = 1;
    let prevRemoteSpeaking = false;

    // Listening nods
    let smoothNod = 0;

    const tick = (now: number) => {
      if (now - lastFrame < targetInterval) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const speaking = isUserSpeakingRef.current;
      const remoteSpeaking = isRemoteSpeakingRef.current;
      const detected = hasDetectionRef.current;
      const ttsPlaying = isTTSPlayingRef.current;

      // === Eye drift ===
      const shouldDrift = !detected && !speaking && !remoteSpeaking;
      const rawDriftX = Math.sin(elapsed * 0.7) * 0.15 + Math.sin(elapsed * 1.3) * 0.08;
      const rawDriftY = Math.cos(elapsed * 0.5) * 0.12 + Math.cos(elapsed * 1.1) * 0.06;
      const driftLerp = shouldDrift ? 0.02 : 0.08;
      const driftMix = shouldDrift ? 1 : 0;
      smoothDriftX += (rawDriftX * driftMix - smoothDriftX) * driftLerp;
      smoothDriftY += (rawDriftY * driftMix - smoothDriftY) * driftLerp;

      // === Thinking state ===
      if (speaking && !wasUserSpeaking) userStoppedTime = null;
      if (!speaking && wasUserSpeaking) userStoppedTime = Date.now();
      wasUserSpeaking = speaking;

      const isThinking =
        userStoppedTime !== null &&
        Date.now() - userStoppedTime > 800 &&
        !remoteSpeaking &&
        !ttsPlaying;

      const thinkLerp = 0.06;
      smoothThinkingX += ((isThinking ? -0.15 : 0) - smoothThinkingX) * thinkLerp;
      smoothThinkingY += ((isThinking ? -0.2 : 0) - smoothThinkingY) * thinkLerp;
      smoothBrowRaise += ((isThinking ? -4 : 0) - smoothBrowRaise) * thinkLerp;

      // === Anticipation flash ===
      if (remoteSpeaking && !prevRemoteSpeaking) anticipationFlash = 1.14;
      prevRemoteSpeaking = remoteSpeaking;
      anticipationFlash += (1 - anticipationFlash) * 0.15;
      if (Math.abs(anticipationFlash - 1) < 0.001) anticipationFlash = 1;

      // === Listening nods ===
      const nodTarget = speaking ? Math.sin(elapsed * Math.PI * 0.8) * 2 : 0;
      smoothNod += (nodTarget - smoothNod) * 0.1;

      stateRef.current = {
        driftX: smoothDriftX,
        driftY: smoothDriftY,
        thinkingOffsetX: smoothThinkingX,
        thinkingOffsetY: smoothThinkingY,
        thinkingEyebrowRaise: smoothBrowRaise,
        anticipationScale: anticipationFlash,
        listeningNodRotation: smoothNod
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return stateRef;
};
