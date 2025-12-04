/**
 * useFaceAnimation Hook
 * Port from mobile client (stella-mobile-client/app/components/faces/defaultFace.tsx)
 * Handles blinking animation and eye state
 */

import { useEffect, useRef } from 'react';
import { useMotionValue } from 'framer-motion';
import type { EyeState } from '../types';

const BLINK_DURATION = 150;
const BLINK_INTERVAL_MIN = 3000;
const BLINK_INTERVAL_MAX = 8000;

interface UseFaceAnimationOptions {
  isUserSpeaking?: boolean;
  pupilX: number;
  pupilY: number;
}

export const useFaceAnimation = ({
  isUserSpeaking = false,
  pupilX,
  pupilY
}: UseFaceAnimationOptions) => {
  const leftEyeScale = useMotionValue(1);
  const rightEyeScale = useMotionValue(1);
  const eyeScaleMultiplier = useMotionValue(1);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Blinking animation
  useEffect(() => {
    const startBlinking = () => {
      if (blinkTimerRef.current) {
        clearTimeout(blinkTimerRef.current);
      }

      const randomInterval =
        BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);

      blinkTimerRef.current = setTimeout(() => {
        // Blink animation: close eyes then open
        leftEyeScale.set(0.05);
        rightEyeScale.set(0.05);

        setTimeout(() => {
          leftEyeScale.set(1);
          rightEyeScale.set(1);
        }, BLINK_DURATION);

        startBlinking();
      }, randomInterval);
    };

    startBlinking();

    return () => {
      if (blinkTimerRef.current) {
        clearTimeout(blinkTimerRef.current);
      }
    };
  }, [leftEyeScale, rightEyeScale]);

  // Eye scale animation when user is speaking (showing interest)
  useEffect(() => {
    let currentScale = 1.0;
    const targetScale = isUserSpeaking ? 1.05 : 1.0;
    const LERP_FACTOR = 0.15;

    const smoothScale = () => {
      currentScale += (targetScale - currentScale) * LERP_FACTOR;
      eyeScaleMultiplier.set(currentScale);
      rafIdRef.current = requestAnimationFrame(smoothScale);
    };

    rafIdRef.current = requestAnimationFrame(smoothScale);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isUserSpeaking, eyeScaleMultiplier]);

  // Calculate final eye states
  const leftEye: EyeState = {
    x: pupilX,
    y: pupilY,
    scale: leftEyeScale.get()
  };

  const rightEye: EyeState = {
    x: pupilX,
    y: pupilY,
    scale: rightEyeScale.get()
  };

  return {
    leftEye,
    rightEye,
    leftEyeScale,
    rightEyeScale,
    eyeScaleMultiplier
  };
};
