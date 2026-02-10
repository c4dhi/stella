/**
 * useFaceAnimation Hook
 * Handles blinking and debounced face detection.
 * Eye scale multiplier and pupil dilation are returned as plain target numbers —
 * Framer Motion in FaceRenderer handles the smooth interpolation.
 * This eliminates 2 RAF loops compared to the previous MotionValue LERP approach.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useMotionValue, animate } from 'framer-motion';
import type { EyeState } from '../types';

const BLINK_INTERVAL_MIN = 3000;
const BLINK_INTERVAL_MAX = 8000;
const DOUBLE_BLINK_CHANCE = 0.3;
const DOUBLE_BLINK_DELAY = 250;
const DETECTION_HOLD_MS = 800;

interface UseFaceAnimationOptions {
  isUserSpeaking?: boolean;
  hasDetection?: boolean;
  pupilX: number;
  pupilY: number;
}

export const useFaceAnimation = ({
  isUserSpeaking = false,
  hasDetection = false,
  pupilX,
  pupilY
}: UseFaceAnimationOptions) => {
  const leftEyeScale = useMotionValue(1);
  const rightEyeScale = useMotionValue(1);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Debounced face detection ---
  // stableDetection only goes false after DETECTION_HOLD_MS of no detection
  const [stableDetection, setStableDetection] = useState(false);
  const detectionLostAtRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hasDetection) {
      // Detection present — immediately mark stable, cancel any pending timeout
      detectionLostAtRef.current = null;
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setStableDetection(true);
    } else if (detectionLostAtRef.current === null) {
      // Detection just dropped — start hold timer
      detectionLostAtRef.current = Date.now();
      holdTimerRef.current = setTimeout(() => {
        setStableDetection(false);
        detectionLostAtRef.current = null;
      }, DETECTION_HOLD_MS);
    }
  }, [hasDetection]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  // --- Smooth blinks using Framer Motion animate() ---
  const doBlink = useCallback(() => {
    animate(leftEyeScale, 0.05, { duration: 0.1, ease: 'easeIn' }).then(() => {
      animate(leftEyeScale, 1, { duration: 0.15, ease: 'easeOut' });
    });
    animate(rightEyeScale, 0.05, { duration: 0.1, ease: 'easeIn' }).then(() => {
      animate(rightEyeScale, 1, { duration: 0.15, ease: 'easeOut' });
    });
  }, [leftEyeScale, rightEyeScale]);

  useEffect(() => {
    const startBlinking = () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);

      const interval = BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);

      blinkTimerRef.current = setTimeout(() => {
        doBlink();
        if (Math.random() < DOUBLE_BLINK_CHANCE) {
          setTimeout(() => doBlink(), DOUBLE_BLINK_DELAY);
        }
        startBlinking();
      }, interval);
    };

    startBlinking();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, [doBlink]);

  // --- Derived target values (Framer Motion animates these in FaceRenderer) ---
  const eyeWidenScale = isUserSpeaking ? 1.08 : 1.0;
  const pupilDilation = stableDetection ? 1.35 : 1.0;

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
    eyeWidenScale,
    pupilDilation
  };
};
