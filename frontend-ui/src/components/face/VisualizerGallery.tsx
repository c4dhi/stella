/**
 * Visualizer Gallery
 * Slide-out panel for selecting different visualizer themes
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { VisualizerType, VISUALIZER_CONFIGS } from './types';

interface VisualizerGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  currentVisualizer: VisualizerType;
  onSelect: (visualizer: VisualizerType) => void;
}

// Generate preview particles for each theme
const generatePreviewStars = () =>
  Array.from({ length: 15 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    opacity: Math.random() * 0.7 + 0.3,
  }));

const generatePreviewRain = () =>
  Array.from({ length: 8 }, (_, i) => ({
    id: i,
    left: 10 + Math.random() * 80,
    top: Math.random() * 80,
  }));

const generatePreviewSnow = () =>
  Array.from({ length: 10 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 80,
    size: Math.random() * 3 + 2,
  }));

const generatePreviewBokeh = () =>
  Array.from({ length: 6 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() * 15 + 8,
    color: ['#dc2626', '#fbbf24', '#22c55e'][Math.floor(Math.random() * 3)],
    opacity: Math.random() * 0.5 + 0.3,
  }));

const VisualizerGallery: React.FC<VisualizerGalleryProps> = ({
  isOpen,
  onClose,
  currentVisualizer,
  onSelect,
}) => {
  // Memoize preview particles
  const previewStars = useMemo(() => generatePreviewStars(), []);
  const previewRain = useMemo(() => generatePreviewRain(), []);
  const previewSnow = useMemo(() => generatePreviewSnow(), []);
  const previewBokeh = useMemo(() => generatePreviewBokeh(), []);

  const renderPreview = (id: VisualizerType) => {
    switch (id) {
      case 'face':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Simple face preview */}
            <div className="relative w-16 h-16">
              {/* Eyes */}
              <div className="absolute top-4 left-2 w-4 h-4 bg-white rounded-full" />
              <div className="absolute top-4 right-2 w-4 h-4 bg-white rounded-full" />
              {/* Mouth */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-6 h-2 border-b-2 border-white/60 rounded-b-full" />
            </div>
          </div>
        );

      case 'sphere':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-16 h-16 rounded-full"
              style={{
                background: 'radial-gradient(circle at 30% 30%, rgba(124, 58, 237, 0.8) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(6, 182, 212, 0.6) 0%, transparent 40%), radial-gradient(circle at 50% 50%, rgba(20, 20, 40, 1) 0%, rgba(10, 10, 20, 1) 100%)',
                boxShadow: '0 0 20px rgba(124, 58, 237, 0.5), 0 0 40px rgba(6, 182, 212, 0.3)',
              }}
            />
          </div>
        );

      case 'galaxy':
        return (
          <>
            {previewStars.map((star) => (
              <div
                key={star.id}
                className="absolute bg-white rounded-full"
                style={{
                  width: '2px',
                  height: '2px',
                  left: `${star.left}%`,
                  top: `${star.top}%`,
                  opacity: star.opacity,
                }}
              />
            ))}
          </>
        );

      case 'rainy':
        return (
          <>
            {previewRain.map((drop) => (
              <div
                key={drop.id}
                className="absolute w-px h-3 bg-white/40"
                style={{
                  left: `${drop.left}%`,
                  top: `${drop.top}%`,
                }}
              />
            ))}
          </>
        );

      case 'snowy':
        return (
          <>
            {previewSnow.map((flake) => (
              <div
                key={flake.id}
                className="absolute bg-white rounded-full"
                style={{
                  width: `${flake.size}px`,
                  height: `${flake.size}px`,
                  left: `${flake.left}%`,
                  top: `${flake.top}%`,
                  opacity: 0.7,
                }}
              />
            ))}
            <div className="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-t from-white/80 to-transparent" />
          </>
        );

      case 'christmas':
        return (
          <>
            {previewBokeh.map((light) => (
              <div
                key={light.id}
                className="absolute rounded-full blur-sm"
                style={{
                  width: `${light.size}px`,
                  height: `${light.size}px`,
                  left: `${light.left}%`,
                  top: `${light.top}%`,
                  backgroundColor: light.color,
                  opacity: light.opacity,
                  boxShadow: `0 0 ${light.size}px ${light.color}`,
                }}
              />
            ))}
          </>
        );

      case 'sunny':
        return (
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2">
            {/* Sun rays preview */}
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="absolute w-0.5 bg-gradient-to-b from-yellow-200/60 to-transparent"
                style={{
                  height: '30px',
                  transformOrigin: 'top center',
                  transform: `rotate(${i * 45}deg)`,
                  left: '0',
                  top: '0',
                }}
              />
            ))}
            {/* Sun circle */}
            <div className="absolute w-6 h-6 rounded-full bg-yellow-300 -translate-x-1/2 -translate-y-1/2 blur-sm opacity-80" />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/30 z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="absolute top-0 right-0 h-full w-80 bg-black/80 backdrop-blur-md border-l border-white/10 z-40 overflow-y-auto"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="p-6 flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-white text-xl font-light">Visualizers</h3>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Visualizer Cards */}
              <div className="flex flex-col gap-3">
                {VISUALIZER_CONFIGS.map((config) => (
                  <button
                    key={config.id}
                    onClick={() => {
                      onSelect(config.id);
                      onClose();
                    }}
                    className={`relative w-full h-28 rounded-lg overflow-hidden border-2 transition-all duration-300 ${
                      currentVisualizer === config.id
                        ? `border-white/60 scale-[1.02]`
                        : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    {/* Background */}
                    <div className={`absolute inset-0 ${config.previewBg}`}>
                      {renderPreview(config.id)}
                    </div>

                    {/* Label */}
                    <div className={`absolute bottom-2 left-3 text-sm font-light ${
                      config.id === 'snowy' || config.id === 'sunny' ? 'text-slate-700' : 'text-white'
                    }`}>
                      {config.name}
                    </div>

                    {/* Selected indicator */}
                    {currentVisualizer === config.id && (
                      <div className={`absolute top-2 right-2 w-6 h-6 ${config.checkmarkColor} rounded-full flex items-center justify-center`}>
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default VisualizerGallery;
