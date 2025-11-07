/**
 * GRACE Face Component
 * Main face component that integrates tracking, animation, and rendering
 * Port from mobile client with web-specific adaptations
 */

import React, { useMemo } from 'react';
import FaceRenderer from './FaceRenderer';
import { useFaceTracking } from './hooks/useFaceTracking';
import { useFaceAnimation } from './hooks/useFaceAnimation';
import { useMouthAnimation } from './hooks/useMouthAnimation';
import type { GraceFaceProps } from './types';

const GraceFace: React.FC<GraceFaceProps> = ({
  isUserSpeaking = false,
  isRemoteSpeaking = false,
  audioLevel = 0,
  eyeEmotion = 'listening',
  mouthEmotion = 'listening',
  size,
  className = ''
}) => {
  // Face tracking (webcam with mouse fallback)
  const { trackingData } = useFaceTracking({
    enableWebcam: true,
    fallbackToMouse: true,
    smoothingFactor: 0.25
  });

  // Calculate pupil position from tracking data
  // Normalize from [0, 1] to [-1, 1]
  // Negate X to fix mirrored movement (left=left, right=right)
  const pupilX = -(trackingData.position.x - 0.5) * 2;
  const pupilY = (trackingData.position.y - 0.5) * 2;

  // Face animation (blinking, eye scale)
  const { leftEye, rightEye, leftEyeScale, rightEyeScale } = useFaceAnimation({
    isUserSpeaking,
    pupilX,
    pupilY
  });

  // Mouth animation (audio-reactive)
  const { mouthOpenness } = useMouthAnimation({
    audioLevel,
    isRemoteSpeaking,
    emotion: mouthEmotion,
    smoothingFactor: 0.5  // Higher = faster response (was 0.2)
  });

  // Calculate responsive size
  const faceSize = useMemo(() => {
    if (size) return size;

    // Responsive sizing based on viewport
    if (typeof window !== 'undefined') {
      const minDimension = Math.min(window.innerWidth, window.innerHeight);
      if (minDimension < 768) return 500; // Mobile
      if (minDimension < 1024) return 650; // Tablet
      return 800; // Desktop
    }

    return 650; // Default
  }, [size]);

  // Calculate head rotation based on gaze direction
  const headRotation = pupilX * 8; // -8 to +8 degrees
  const eyebrowHeight = 0; // Can be animated based on emotion

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <FaceRenderer
        size={faceSize}
        leftEye={{
          x: leftEye.x,
          y: leftEye.y,
          scale: leftEyeScale.get()
        }}
        rightEye={{
          x: rightEye.x,
          y: rightEye.y,
          scale: rightEyeScale.get()
        }}
        mouthOpenness={mouthOpenness.get()}
        mouthEmotion={mouthEmotion}
        eyeEmotion={eyeEmotion}
        headRotation={headRotation}
        eyebrowHeight={eyebrowHeight}
      />
    </div>
  );
};

export default GraceFace;
