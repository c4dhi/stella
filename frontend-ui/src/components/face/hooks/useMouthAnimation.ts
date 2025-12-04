/**
 * useMouthAnimation Hook
 * Port from mobile client (stella-mobile-client/app/components/faces/defaultFace.tsx)
 * Handles audio-reactive mouth animation with smooth interpolation
 */

import { useEffect, useRef } from 'react';
import { useMotionValue, animate } from 'framer-motion';
import type { UseMouthAnimationOptions } from '../types';

export const useMouthAnimation = ({
  audioLevel,
  isRemoteSpeaking,
  emotion,
  smoothingFactor = 0.2
}: UseMouthAnimationOptions) => {
  const mouthOpenness = useMotionValue(0);
  const rafIdRef = useRef<number | null>(null);

  // Smooth audio level interpolation using requestAnimationFrame
  useEffect(() => {
    let currentValue = 0;

    const smoothAudio = () => {
      // LERP (Linear Interpolation) for smooth transitions
      const target = isRemoteSpeaking ? audioLevel : 0;
      currentValue += (target - currentValue) * smoothingFactor;

      // Update motion value
      mouthOpenness.set(currentValue);

      // Continue animation loop
      rafIdRef.current = requestAnimationFrame(smoothAudio);
    };

    rafIdRef.current = requestAnimationFrame(smoothAudio);

    // Cleanup
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [audioLevel, isRemoteSpeaking, smoothingFactor, mouthOpenness]);

  return {
    mouthOpenness
  };
};
