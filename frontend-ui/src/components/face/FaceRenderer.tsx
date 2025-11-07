/**
 * GRACE Face Renderer
 * Port from mobile client (grace-ai-mobile-client/app/components/faces/defaultFace.tsx)
 * Renders eyes, eyebrows, and mouth using SVG
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { FaceRendererProps, MouthEmotion, EyeEmotion } from './types';

// Constants (matching mobile client)
const EYE_SIZE = 220;
const IRIS_SIZE = EYE_SIZE * 0.8;
const PUPIL_SIZE_BASE = IRIS_SIZE * 0.35;
const MAX_PUPIL_OFFSET_X = ((IRIS_SIZE - PUPIL_SIZE_BASE) / 2) * 0.8;
const MAX_PUPIL_OFFSET_Y = MAX_PUPIL_OFFSET_X / 2;

const IRIS_COLOR = '#FFFFFF';
const PUPIL_COLOR = '#000000';
const REFLECTION_COLOR = '#FFFFFF';
const MOUTH_COLOR = '#B0B0B0';      // Light grey for softer appearance on black background
const EYEBROW_COLOR = '#B0B0B0';    // Light grey matching mouth
const EYEBROW_WIDTH = 180;
const EYEBROW_THICKNESS = 12;
const MOUTH_HEIGHT_BASE = 70;  // Increased from 50 for larger mouth

// Mouth expression shapes
const MOUTH_EXPRESSIONS: Record<MouthEmotion, { curvature: number; width: number; height: number }> = {
  neutral: { curvature: 0, width: 0.5, height: 1 },
  smile: { curvature: 1, width: 0.6, height: 0.8 },
  'big-smile': { curvature: 1.8, width: 0.9, height: 0.9 },
  frown: { curvature: -1.0, width: 0.5, height: 0.7 },
  sad: { curvature: -0.8, width: 0.4, height: 0.6 },
  open: { curvature: 0, width: 0.5, height: 1.8 },
  speaking: { curvature: 0, width: 0.6, height: 1.2 },
  'happy-speaking': { curvature: 0.6, width: 0.7, height: 1.2 },
  'sad-speaking': { curvature: -0.4, width: 0.5, height: 1.1 },
  'excited-speaking': { curvature: 1.0, width: 0.8, height: 1.3 },
  whistling: { curvature: 0, width: 0.3, height: 0.6 },
  snoring: { curvature: 0, width: 0.6, height: 1.8 },
  smirk: { curvature: 0.6, width: 0.4, height: 0.7 },
  pout: { curvature: -0.4, width: 0.3, height: 0.9 },
  grin: { curvature: 3.0, width: 0.6, height: 0.3 },
  'tongue-out': { curvature: 0.3, width: 0.7, height: 1.4 },
  nervous: { curvature: -0.3, width: 0.4, height: 0.7 },
  confident: { curvature: 0.8, width: 0.7, height: 0.8 },
  mischievous: { curvature: 0.8, width: 0.5, height: 0.8 },
  listening: { curvature: 0.4, width: 0.5, height: 0.8 }
};

// Eyebrow expression shapes
interface EyebrowShape {
  leftCurvature: number;
  rightCurvature: number;
  leftHeight: number;
  rightHeight: number;
}

const EYEBROW_EXPRESSIONS: Record<EyeEmotion, EyebrowShape> = {
  neutral: { leftCurvature: 0, rightCurvature: 0, leftHeight: 0, rightHeight: 0 },
  happy: { leftCurvature: 0.5, rightCurvature: 0.5, leftHeight: -3, rightHeight: -3 },
  excited: { leftCurvature: 0.7, rightCurvature: 0.7, leftHeight: -8, rightHeight: -8 },
  sleepy: { leftCurvature: -0.5, rightCurvature: -0.5, leftHeight: 5, rightHeight: 5 },
  surprised: { leftCurvature: 0.3, rightCurvature: 0.3, leftHeight: -15, rightHeight: -15 },
  focused: { leftCurvature: -0.3, rightCurvature: -0.3, leftHeight: 8, rightHeight: 8 },
  winking: { leftCurvature: 0.5, rightCurvature: 0, leftHeight: -8, rightHeight: 0 },
  rolling: { leftCurvature: 0, rightCurvature: 0, leftHeight: 0, rightHeight: 0 },
  wide: { leftCurvature: 0.4, rightCurvature: 0.4, leftHeight: -12, rightHeight: -12 },
  squinting: { leftCurvature: -0.6, rightCurvature: -0.6, leftHeight: 12, rightHeight: 12 },
  loving: { leftCurvature: 0.6, rightCurvature: 0.6, leftHeight: -5, rightHeight: -5 },
  listening: { leftCurvature: 0.2, rightCurvature: 0.2, leftHeight: -2, rightHeight: -2 }
};

// Helper function to clamp values
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Helper function to interpolate
const interpolate = (value: number, inputRange: number[], outputRange: number[]): number => {
  if (value <= inputRange[0]) return outputRange[0];
  if (value >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];

  for (let i = 0; i < inputRange.length - 1; i++) {
    if (value >= inputRange[i] && value <= inputRange[i + 1]) {
      const t = (value - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
      return outputRange[i] + t * (outputRange[i + 1] - outputRange[i]);
    }
  }
  return outputRange[0];
};

// Calculate mouth SVG path (matches mobile calculateMouthPath function)
const calculateMouthPath = (
  mouthOpenness: number,
  mouthEmotion: MouthEmotion,
  isSpeaking: boolean
): string => {
  const centerX = 110;
  const centerY = 45;

  const shape = MOUTH_EXPRESSIONS[mouthEmotion] || MOUTH_EXPRESSIONS.neutral;

  if (isSpeaking) {
    // Speaking: O-shaped mouth (ellipse)
    const baseWidth = Math.max(shape.width * MOUTH_HEIGHT_BASE * 0.8, 30);  // Increased from 0.6, 20
    const baseHeight = Math.max(shape.height * 12, 12);  // Increased from 8, 8

    // Use openness to control mouth size (audio-reactive)
    const openness = interpolate(
      mouthOpenness,
      [0, 0.05, 0.2, 0.5, 1.0],
      [0.4, 0.6, 0.9, 1.3, 1.7]
    );

    const ovalHeight = baseHeight * openness;
    const widthFactor = interpolate(openness, [0.4, 1.7], [1.0, 0.85]);
    const ovalWidth = baseWidth * widthFactor;

    const radiusX = ovalWidth / 2;
    const radiusY = ovalHeight / 2;

    // SVG ellipse path
    return `M ${centerX - radiusX} ${centerY}
            A ${radiusX} ${radiusY} 0 1 1 ${centerX + radiusX} ${centerY}
            A ${radiusX} ${radiusY} 0 1 1 ${centerX - radiusX} ${centerY} Z`;
  } else {
    // Not speaking: curved line (smile/neutral)
    const lineWidth = Math.max(shape.width * MOUTH_HEIGHT_BASE * 0.6, 20);
    const startX = centerX - lineWidth / 2;
    const endX = centerX + lineWidth / 2;
    const curveY = centerY + (shape.curvature * 20);
    return `M ${startX} ${centerY} Q ${centerX} ${curveY} ${endX} ${centerY}`;
  }
};

// Calculate eyebrow SVG path
const calculateEyebrowPath = (
  curvature: number,
  heightOffset: number,
  isLeft: boolean
): string => {
  const centerX = 50;
  const baseY = 45;
  const eyebrowWidth = 80;

  const startX = centerX - eyebrowWidth / 2;
  const endX = centerX + eyebrowWidth / 2;

  const baseCurve = -10;
  const emotionCurve = curvature * 15;
  const controlY = baseY + baseCurve + emotionCurve + heightOffset * 0.5;

  return `M ${startX} ${baseY + heightOffset * 0.5} Q ${centerX} ${controlY} ${endX} ${baseY + heightOffset * 0.5}`;
};

const FaceRenderer: React.FC<FaceRendererProps> = ({
  size,
  leftEye,
  rightEye,
  mouthOpenness,
  mouthEmotion,
  eyeEmotion,
  headRotation,
  eyebrowHeight
}) => {
  const scale = size / 600; // Base size is 600px

  // Hysteresis for smooth mouth shape transitions (prevents jitter)
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ENTER_THRESHOLD = 0.15;  // Must exceed this to start showing oval (increased from 0.10)
  const EXIT_THRESHOLD = 0.03;   // Must drop below this to show smile

  // Apply hysteresis to prevent rapid switching between line and oval
  useEffect(() => {
    if (!isSpeaking && mouthOpenness > ENTER_THRESHOLD) {
      setIsSpeaking(true);
    } else if (isSpeaking && mouthOpenness < EXIT_THRESHOLD) {
      setIsSpeaking(false);
    }
  }, [mouthOpenness, isSpeaking]);

  const eyebrowShape = EYEBROW_EXPRESSIONS[eyeEmotion] || EYEBROW_EXPRESSIONS.neutral;
  const leftEyebrowPath = calculateEyebrowPath(
    eyebrowShape.leftCurvature,
    eyebrowShape.leftHeight + eyebrowHeight,
    true
  );
  const rightEyebrowPath = calculateEyebrowPath(
    eyebrowShape.rightCurvature,
    eyebrowShape.rightHeight + eyebrowHeight,
    false
  );

  const mouthPath = calculateMouthPath(mouthOpenness, mouthEmotion, isSpeaking);

  const renderEye = (eye: typeof leftEye, index: number) => {
    const pupilOffsetX = clamp(eye.x * MAX_PUPIL_OFFSET_X, -MAX_PUPIL_OFFSET_X, MAX_PUPIL_OFFSET_X);
    const pupilOffsetY = clamp(eye.y * MAX_PUPIL_OFFSET_Y, -MAX_PUPIL_OFFSET_Y, MAX_PUPIL_OFFSET_Y);

    return (
      <div
        key={index}
        className="flex flex-col items-center"
        style={{ marginLeft: index === 0 ? 0 : EYE_SIZE * 0.08 * scale }}
      >
        {/* Eyebrow */}
        <div style={{ width: EYEBROW_WIDTH * scale, height: 60 * scale, marginBottom: 0 }}>
          <svg width="100%" height="100%" viewBox="0 0 100 60">
            <motion.path
              d={index === 0 ? leftEyebrowPath : rightEyebrowPath}
              stroke={EYEBROW_COLOR}
              strokeWidth={EYEBROW_THICKNESS}
              strokeLinecap="round"
              fill="none"
              initial={false}
              animate={{ d: index === 0 ? leftEyebrowPath : rightEyebrowPath }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            />
          </svg>
        </div>

        {/* Eye */}
        <motion.div
          className="relative flex items-center justify-center overflow-hidden rounded-full"
          style={{
            width: EYE_SIZE * scale,
            height: EYE_SIZE * scale,
            backgroundColor: 'transparent',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
          }}
          animate={{
            scaleY: eye.scale
          }}
          transition={{ duration: 0.15 }}
        >
          {/* Iris */}
          <div
            className="relative flex items-center justify-center rounded-full"
            style={{
              width: IRIS_SIZE * scale,
              height: IRIS_SIZE * scale,
              backgroundColor: IRIS_COLOR
            }}
          >
            {/* Pupil Container (with offset) */}
            <motion.div
              className="relative flex items-center justify-center"
              style={{
                width: PUPIL_SIZE_BASE * scale,
                height: PUPIL_SIZE_BASE * scale
              }}
              animate={{
                x: pupilOffsetX * scale,
                y: pupilOffsetY * scale
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {/* Pupil */}
              <div
                className="absolute rounded-full"
                style={{
                  width: PUPIL_SIZE_BASE * scale,
                  height: PUPIL_SIZE_BASE * scale,
                  backgroundColor: PUPIL_COLOR
                }}
              />

              {/* Reflection */}
              <div
                className="absolute rounded-full"
                style={{
                  width: PUPIL_SIZE_BASE * 0.3 * scale,
                  height: PUPIL_SIZE_BASE * 0.3 * scale,
                  backgroundColor: REFLECTION_COLOR,
                  top: `15%`,
                  left: `20%`,
                  opacity: 0.9
                }}
              />
            </motion.div>
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <motion.div
      className="flex flex-col items-center justify-center"
      animate={{
        rotate: headRotation
      }}
      transition={{ type: 'spring', stiffness: 150, damping: 20 }}
    >
      {/* Eyes Row */}
      <div className="flex items-center" style={{ marginBottom: EYE_SIZE * 0.05 * scale }}>
        {renderEye(leftEye, 0)}
        {renderEye(rightEye, 1)}
      </div>

      {/* Mouth */}
      <div
        className="flex items-center justify-center"
        style={{
          width: 220 * scale,
          height: 90 * scale,
          marginTop: EYE_SIZE * -0.01 * scale
        }}
      >
        <svg width="100%" height="100%" viewBox="0 0 220 90">
          <motion.path
            d={mouthPath}
            stroke={MOUTH_COLOR}
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            initial={false}
            animate={{ d: mouthPath }}
            transition={{ duration: 0.1 }}  // Smooth transition for shape changes
          />
        </svg>
      </div>
    </motion.div>
  );
};

export default FaceRenderer;
