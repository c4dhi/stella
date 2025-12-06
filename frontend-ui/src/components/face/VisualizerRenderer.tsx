/**
 * VisualizerRenderer
 * Shared component for rendering visualizers across different views
 * Eliminates duplication between StellaFaceModal and ParticipantSessionView
 */

import React from 'react';
import { motion } from 'framer-motion';
import StellaFace from './StellaFace';
import SphereVisualizer from './visualizers/SphereVisualizer';
import WeatherVisualizer from './visualizers/WeatherVisualizer';
import type { VisualizerType, VisualizerProps } from './types';

interface VisualizerRendererProps extends VisualizerProps {
  type: VisualizerType;
}

const VisualizerRenderer: React.FC<VisualizerRendererProps> = ({
  type,
  audioLevel,
  isRemoteSpeaking,
  isUserSpeaking = false,
}) => {
  switch (type) {
    case 'face':
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <StellaFace
            isUserSpeaking={isUserSpeaking}
            isRemoteSpeaking={isRemoteSpeaking}
            audioLevel={audioLevel}
            eyeEmotion="listening"
            mouthEmotion={isRemoteSpeaking ? 'speaking' : 'smile'}
          />
        </motion.div>
      );

    case 'sphere':
      return (
        <SphereVisualizer
          audioLevel={audioLevel}
          isRemoteSpeaking={isRemoteSpeaking}
        />
      );

    case 'galaxy':
    case 'rainy':
    case 'snowy':
    case 'christmas':
    case 'sunny':
      return (
        <WeatherVisualizer
          theme={type}
          audioLevel={audioLevel}
          isRemoteSpeaking={isRemoteSpeaking}
        />
      );

    default:
      return null;
  }
};

export default VisualizerRenderer;
