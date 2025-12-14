/**
 * Weather Visualizer
 * Multiple weather-themed visualizations with particle effects
 * Uses AudioReactiveSiriOrb component for the central sphere
 */

import React, { useEffect, useState } from 'react';
import AudioReactiveSiriOrb from './AudioReactiveSiriOrb';
import { useResponsiveSphereSize } from './useResponsiveSphereSize';

type WeatherTheme = 'galaxy' | 'rainy' | 'snowy' | 'christmas' | 'sunny';

interface WeatherVisualizerProps {
  theme: WeatherTheme;
  audioLevel?: number;
  isRemoteSpeaking?: boolean;
}

// Background configurations for each theme
const backgroundConfig: Record<WeatherTheme, string> = {
  galaxy: 'bg-black',
  rainy: 'bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900',
  snowy: 'bg-gradient-to-b from-slate-300 via-slate-200 to-slate-100',
  christmas: 'bg-gradient-to-b from-slate-900 via-green-950 to-red-950',
  sunny: 'bg-gradient-to-b from-sky-200 via-sky-100 to-emerald-100',
};

// Generate particles for each theme
const generateStars = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() * 2 + 1,
    opacity: Math.random() * 0.7 + 0.3,
    twinkleDuration: Math.random() * 3 + 2,
    twinkleDelay: Math.random() * 5,
  }));

const generateRaindrops = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    duration: Math.random() * 1 + 0.5,
    // Stagger the drops so they don't all start at once
    delay: Math.random() * 2,
    height: Math.random() * 20 + 10,
  }));

const generateSnowflakes = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 5 + 5,
    // Stagger the flakes so they don't all start at once
    delay: Math.random() * 3,
  }));

const generateBokehLights = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: Math.random() * 30 + 10,
    color: ['#dc2626', '#fbbf24', '#22c55e'][Math.floor(Math.random() * 3)],
    opacity: Math.random() * 0.5 + 0.3,
    duration: Math.random() * 4 + 3,
    delay: Math.random() * 3,
  }));

const WeatherVisualizer: React.FC<WeatherVisualizerProps> = ({
  theme,
  audioLevel = 0,
  isRemoteSpeaking = false,
}) => {
  const bgClass = backgroundConfig[theme];
  const sphereSize = useResponsiveSphereSize(180, 360, 0.32);

  // Generate particles once per theme
  const [particles, setParticles] = useState<{
    stars: ReturnType<typeof generateStars>;
    raindrops: ReturnType<typeof generateRaindrops>;
    snowflakes: ReturnType<typeof generateSnowflakes>;
    bokehLights: ReturnType<typeof generateBokehLights>;
  }>({
    stars: [],
    raindrops: [],
    snowflakes: [],
    bokehLights: [],
  });

  useEffect(() => {
    setParticles({
      stars: generateStars(80),
      raindrops: generateRaindrops(50),
      snowflakes: generateSnowflakes(40),
      bokehLights: generateBokehLights(20),
    });
  }, [theme]);

  return (
    <div className={`relative w-full h-full flex items-center justify-center overflow-hidden ${bgClass}`}>
      {/* Galaxy - Stars */}
      {theme === 'galaxy' && (
        <div className="absolute inset-0 pointer-events-none">
          {particles.stars.map((star) => (
            <div
              key={star.id}
              className="absolute bg-white rounded-full"
              style={{
                left: `${star.left}%`,
                top: `${star.top}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
                opacity: star.opacity,
                boxShadow: `0 0 ${star.size * 2}px rgba(255, 255, 255, ${star.opacity * 0.8})`,
                animation: `twinkle ${star.twinkleDuration}s ease-in-out infinite ${star.twinkleDelay}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Rainy - Raindrops */}
      {theme === 'rainy' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {particles.raindrops.map((drop) => (
            <div
              key={drop.id}
              className="absolute w-px bg-gradient-to-b from-transparent via-white/40 to-white/60"
              style={{
                left: `${drop.left}%`,
                top: '-10vh', // Start above viewport
                height: `${drop.height}px`,
                opacity: 0, // Initially invisible
                animation: `rain-fall ${drop.duration}s linear infinite ${drop.delay}s`,
                animationFillMode: 'both',
              }}
            />
          ))}
        </div>
      )}

      {/* Snowy - Snowflakes */}
      {theme === 'snowy' && (
        <>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {particles.snowflakes.map((flake) => (
              <div
                key={flake.id}
                className="absolute bg-white rounded-full"
                style={{
                  left: `${flake.left}%`,
                  top: '-10vh', // Start above viewport
                  width: `${flake.size}px`,
                  height: `${flake.size}px`,
                  opacity: 0, // Initially invisible
                  boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
                  animation: `snow-fall ${flake.duration}s linear infinite ${flake.delay}s`,
                  animationFillMode: 'both',
                }}
              />
            ))}
          </div>
          {/* Snow accumulation at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white/80 to-transparent" />
        </>
      )}

      {/* Christmas - Bokeh lights */}
      {theme === 'christmas' && (
        <div className="absolute inset-0 pointer-events-none">
          {particles.bokehLights.map((light) => (
            <div
              key={light.id}
              className="absolute rounded-full blur-sm"
              style={{
                left: `${light.left}%`,
                top: `${light.top}%`,
                width: `${light.size}px`,
                height: `${light.size}px`,
                backgroundColor: light.color,
                opacity: light.opacity,
                boxShadow: `0 0 ${light.size * 2}px ${light.color}`,
                animation: `bokeh-float ${light.duration}s ease-in-out infinite ${light.delay}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Sunny - Sun and rays */}
      {theme === 'sunny' && (
        <div className="absolute top-8 left-8 pointer-events-none">
          {/* Sun rays */}
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className="absolute w-1 bg-gradient-to-b from-yellow-300/60 to-transparent"
              style={{
                height: '80px',
                transformOrigin: 'top center',
                transform: `rotate(${i * 30}deg)`,
                left: '40px',
                top: '40px',
                animation: `sun-ray-shimmer ${2 + i * 0.2}s ease-in-out infinite ${i * 0.1}s`,
              }}
            />
          ))}
          {/* Sun circle */}
          <div
            className="absolute w-20 h-20 rounded-full bg-yellow-300"
            style={{
              boxShadow: '0 0 60px rgba(253, 224, 71, 0.8), 0 0 120px rgba(253, 224, 71, 0.4)',
            }}
          />
        </div>
      )}

      {/* Central sphere - SiriOrb with audio reactivity */}
      <AudioReactiveSiriOrb
        theme={theme}
        size={sphereSize}
        audioLevel={audioLevel}
        isRemoteSpeaking={isRemoteSpeaking}
      />
    </div>
  );
};

export default WeatherVisualizer;
