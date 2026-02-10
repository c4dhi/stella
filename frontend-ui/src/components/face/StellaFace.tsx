/**
 * STELLA Face Component
 * Main face component that integrates tracking, animation, and rendering
 * Port from mobile client with web-specific adaptations
 */

import React, { useMemo } from 'react';
import FaceRenderer from './FaceRenderer';
import { useFaceTracking } from './hooks/useFaceTracking';
import { useFaceAnimation } from './hooks/useFaceAnimation';
import { useMouthAnimation } from './hooks/useMouthAnimation';
import { useIdleBehavior } from './hooks/useIdleBehavior';
import { useStore } from '../../store';
import type { StellaFaceProps } from './types';

const StellaFace: React.FC<StellaFaceProps> = ({
  isUserSpeaking: isUserSpeakingProp,
  isRemoteSpeaking: isRemoteSpeakingProp,
  audioLevel = 0,
  eyeEmotion = 'listening',
  mouthEmotion = 'listening',
  size,
  className = ''
}) => {
  // Derive isUserSpeaking from Zustand store if not passed as prop
  const isMuted = useStore((s) => s.isMuted);
  const isRecording = useStore((s) => s.isRecording);
  const storeIsRemoteSpeaking = useStore((s) => s.isRemoteSpeaking);

  const isUserSpeaking = isUserSpeakingProp ?? (!isMuted && isRecording);
  const isRemoteSpeaking = isRemoteSpeakingProp ?? storeIsRemoteSpeaking;

  // Face tracking (webcam with mouse fallback)
  const { trackingData } = useFaceTracking({
    enableWebcam: true,
    fallbackToMouse: true,
    smoothingFactor: 0.25
  });

  // Calculate pupil position from tracking data
  const pupilX = -(trackingData.position.x - 0.5) * 2;
  const pupilY = (trackingData.position.y - 0.5) * 2;

  // Face animation (blinking, detection debounce)
  const { leftEye, rightEye, leftEyeScale, rightEyeScale, eyeWidenScale, pupilDilation } =
    useFaceAnimation({
      isUserSpeaking,
      hasDetection: trackingData.hasDetection,
      pupilX,
      pupilY
    });

  // Mouth animation (audio-reactive with spring physics)
  const { mouthOpenness, mouthSpread } = useMouthAnimation({
    audioLevel,
    isRemoteSpeaking,
    emotion: mouthEmotion,
    smoothingFactor: 0.5
  });

  // Idle behavior (drift, thinking, anticipation, nods — single RAF loop)
  const behaviorState = useIdleBehavior({
    isUserSpeaking,
    isRemoteSpeaking,
    hasDetection: trackingData.hasDetection
  });

  // Calculate responsive size
  const faceSize = useMemo(() => {
    if (size) return size;
    if (typeof window !== 'undefined') {
      const minDimension = Math.min(window.innerWidth, window.innerHeight);
      if (minDimension < 768) return 500;
      if (minDimension < 1024) return 650;
      return 800;
    }
    return 650;
  }, [size]);

  // Compose compound values
  const b = behaviorState.current;

  const finalPupilX = pupilX + b.driftX + b.thinkingOffsetX;
  const finalPupilY = pupilY + b.driftY + b.thinkingOffsetY;

  const headRotation = finalPupilX * 8 + b.listeningNodRotation;
  const eyebrowHeight = b.thinkingEyebrowRaise;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <FaceRenderer
        size={faceSize}
        leftEye={{
          x: finalPupilX,
          y: finalPupilY,
          scale: leftEyeScale.get() * eyeWidenScale * b.anticipationScale
        }}
        rightEye={{
          x: finalPupilX,
          y: finalPupilY,
          scale: rightEyeScale.get() * eyeWidenScale * b.anticipationScale
        }}
        mouthOpenness={mouthOpenness.get()}
        mouthSpread={mouthSpread.get()}
        mouthEmotion={mouthEmotion}
        eyeEmotion={eyeEmotion}
        headRotation={headRotation}
        eyebrowHeight={eyebrowHeight}
        pupilDilation={pupilDilation}
        leftEyeScaleY={leftEyeScale}
        rightEyeScaleY={rightEyeScale}
      />
    </div>
  );
};

export default StellaFace;
