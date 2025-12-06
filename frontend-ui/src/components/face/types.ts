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

// Visualizer types for the face modal gallery
export type VisualizerType =
  | 'face'
  | 'sphere'
  | 'galaxy'
  | 'rainy'
  | 'snowy'
  | 'christmas'
  | 'sunny';

// Standard props all visualizers receive
export interface VisualizerProps {
  audioLevel: number;
  isRemoteSpeaking: boolean;
  isUserSpeaking?: boolean;
}

export interface VisualizerConfig {
  id: VisualizerType;
  name: string;
  description: string;
  previewBg: string;
  checkmarkColor: string;
}

export const VISUALIZER_CONFIGS: VisualizerConfig[] = [
  {
    id: 'face',
    name: 'Face',
    description: 'Animated SVG face',
    previewBg: 'bg-black',
    checkmarkColor: 'bg-violet-400',
  },
  {
    id: 'sphere',
    name: 'Sphere',
    description: 'Glowing orb',
    previewBg: 'bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900',
    checkmarkColor: 'bg-violet-400',
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    description: 'Starry night sky',
    previewBg: 'bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950',
    checkmarkColor: 'bg-purple-400',
  },
  {
    id: 'rainy',
    name: 'Rainy',
    description: 'Falling raindrops',
    previewBg: 'bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900',
    checkmarkColor: 'bg-slate-400',
  },
  {
    id: 'snowy',
    name: 'Snowy',
    description: 'Winter wonderland',
    previewBg: 'bg-gradient-to-b from-slate-300 via-slate-200 to-slate-100',
    checkmarkColor: 'bg-slate-400',
  },
  {
    id: 'christmas',
    name: 'Christmas',
    description: 'Festive lights',
    previewBg: 'bg-gradient-to-b from-slate-900 via-green-950 to-red-950',
    checkmarkColor: 'bg-yellow-400',
  },
  {
    id: 'sunny',
    name: 'Sunny',
    description: 'Bright blue sky',
    previewBg: 'bg-gradient-to-b from-sky-200 via-sky-100 to-emerald-100',
    checkmarkColor: 'bg-amber-400',
  },
];
