import { useEffect, useRef, useState, useCallback } from 'react';
import SiriOrb from './SiriOrb';

type HeroSphereDemoProps = {
  minSize?: number;
  maxSize?: number;
  sizeRatio?: number; // Percentage of container's smaller dimension
};

const HeroSphereDemo = ({
  minSize = 140,
  maxSize = 300,
  sizeRatio = 0.6,
}: HeroSphereDemoProps) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [intensity, setIntensity] = useState(0);
  const [sphereSize, setSphereSize] = useState(220);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Responsive size calculation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const smallerDimension = Math.min(rect.width, rect.height);
      const calculatedSize = Math.round(smallerDimension * sizeRatio);
      const clampedSize = Math.max(minSize, Math.min(maxSize, calculatedSize));
      setSphereSize(clampedSize);
    };

    // Initial size calculation
    updateSize();

    // Observe container resize
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [minSize, maxSize, sizeRatio]);

  // Smooth intensity fluctuation during speaking
  const animateIntensity = useCallback(() => {
    if (!isSpeaking) {
      setIntensity(0);
      return;
    }

    // Create expressive speech-like fluctuation
    const time = Date.now() / 1000;

    // Slow wave for overall energy envelope
    const slowWave = Math.sin(time * 1.5) * 0.15;

    // Medium waves for syllable-like rhythm
    const mediumWave = Math.sin(time * 5) * 0.25 + Math.sin(time * 8) * 0.15;

    // Fast waves for vocal texture
    const fastWave = Math.sin(time * 15) * 0.2 + Math.sin(time * 23) * 0.1;

    // Combine with base intensity
    const baseIntensity = 0.5;
    const combined = baseIntensity + slowWave + mediumWave + fastWave;

    setIntensity(Math.max(0.1, Math.min(1, combined)));
    animationRef.current = requestAnimationFrame(animateIntensity);
  }, [isSpeaking]);

  // Sporadic speaking pattern
  useEffect(() => {
    const scheduleNextCycle = () => {
      // Random pause duration: 1-3 seconds
      const pauseDuration = 1000 + Math.random() * 2000;

      timeoutRef.current = setTimeout(() => {
        setIsSpeaking(true);

        // Random speaking duration: 2-4 seconds
        const speakDuration = 2000 + Math.random() * 2000;

        timeoutRef.current = setTimeout(() => {
          setIsSpeaking(false);
          scheduleNextCycle();
        }, speakDuration);
      }, pauseDuration);
    };

    // Start the cycle
    scheduleNextCycle();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Handle intensity animation
  useEffect(() => {
    if (isSpeaking) {
      animateIntensity();
    } else {
      setIntensity(0);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isSpeaking, animateIntensity]);

  // Calculate visual effects based on intensity
  const scale = 1 + intensity * 0.15; // 1.0 -> 1.15
  const brightness = 1 + intensity * 0.5; // 1.0 -> 1.5
  const glowOpacity = intensity * 0.8; // 0 -> 0.8

  return (
    <div
      ref={containerRef}
      className="hero-sphere-wrapper"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      {/* Glow effect behind the sphere */}
      <div
        style={{
          position: 'absolute',
          width: sphereSize * 2,
          height: sphereSize * 2,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.6) 0%, rgba(147, 51, 234, 0.3) 40%, transparent 70%)',
          opacity: glowOpacity,
          transition: 'opacity 0.1s ease-out',
          pointerEvents: 'none',
        }}
      />

      {/* The sphere itself */}
      <div
        style={{
          transform: `scale(${scale})`,
          filter: `brightness(${brightness})`,
          transition: 'transform 0.15s ease-out, filter 0.15s ease-out',
        }}
      >
        <SiriOrb size={`${sphereSize}px`} animationDuration={15} />
      </div>
    </div>
  );
};

export default HeroSphereDemo;
