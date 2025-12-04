/**
 * STELLA Face Component Types
 * Port from mobile client with web-specific adaptations
 */

export type EyeEmotion =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'sleepy'
  | 'surprised'
  | 'focused'
  | 'winking'
  | 'rolling'
  | 'wide'
  | 'squinting'
  | 'loving'
  | 'listening';

export type MouthEmotion =
  | 'neutral'
  | 'smile'
  | 'big-smile'
  | 'frown'
  | 'sad'
  | 'open'
  | 'speaking'
  | 'happy-speaking'
  | 'sad-speaking'
  | 'excited-speaking'
  | 'whistling'
  | 'snoring'
  | 'smirk'
  | 'pout'
  | 'grin'
  | 'tongue-out'
  | 'nervous'
  | 'confident'
  | 'mischievous'
  | 'listening';

export interface FacePosition {
  x: number;
  y: number;
}

export interface EyeState {
  x: number; // Pupil X offset (-1 to 1)
  y: number; // Pupil Y offset (-1 to 1)
  scale: number; // Eye scale (0 to 1, for blinking)
}

export interface FaceTrackingData {
  position: FacePosition;
  hasDetection: boolean;
  method: 'webcam' | 'mouse' | 'none';
}

export interface StellaFaceProps {
  isUserSpeaking?: boolean;
  isRemoteSpeaking?: boolean;
  audioLevel?: number; // 0.0 to 1.0
  eyeEmotion?: EyeEmotion;
  mouthEmotion?: MouthEmotion;
  size?: number; // Face size in pixels (default: responsive)
  className?: string;
}


export interface FaceRendererProps {
  size: number;
  leftEye: EyeState;
  rightEye: EyeState;
  mouthOpenness: number; // 0.0 to 1.0
  mouthEmotion: MouthEmotion;
  eyeEmotion: EyeEmotion;
  headRotation: number; // -15 to 15 degrees
  eyebrowHeight: number; // -5 to 5 pixels
}

export interface UseFaceTrackingOptions {
  enableWebcam?: boolean;
  fallbackToMouse?: boolean;
  smoothingFactor?: number; // LERP factor (0 to 1)
}

export interface UseMouthAnimationOptions {
  audioLevel: number;
  isRemoteSpeaking: boolean;
  emotion: MouthEmotion;
  smoothingFactor?: number;
}
