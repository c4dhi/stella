/**
 * Sphere Visualizer
 * Animated gradient orb from stella-landingpage with audio reactivity
 * Uses unified ThemeSphere component
 */

import React from 'react';
import { motion } from 'framer-motion';
import ThemeSphere from './ThemeSphere';
import { useResponsiveSphereSize } from './useResponsiveSphereSize';

interface SphereVisualizerProps {
  audioLevel?: number;
  isRemoteSpeaking?: boolean;
}

const SphereVisualizer: React.FC<SphereVisualizerProps> = ({
  audioLevel = 0,
  isRemoteSpeaking = false,
}) => {
  const sphereSize = useResponsiveSphereSize(200, 400, 0.38);
  const glowSize = sphereSize * 1.8; // Glow is proportional to sphere

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black">
      {/* Outer ambient glow layer */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: glowSize,
          height: glowSize,
          background: `radial-gradient(circle, rgba(124, 58, 237, 0.25) 0%, rgba(6, 182, 212, 0.15) 40%, transparent 70%)`,
          filter: `blur(60px)`,
        }}
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.6, 0.8, 0.6],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Main sphere - unified component from landing page */}
      <ThemeSphere
        theme="sphere"
        size={sphereSize}
        audioLevel={audioLevel}
        isRemoteSpeaking={isRemoteSpeaking}
      />
    </div>
  );
};

export default SphereVisualizer;
