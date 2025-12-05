/**
 * Hook to get responsive sphere size based on viewport
 * Uses the smaller viewport dimension (vmin equivalent) to maintain proportions
 */

import { useState, useEffect } from 'react';

export const useResponsiveSphereSize = (
  minSize = 200,
  maxSize = 400,
  ratio = 0.35
) => {
  const [size, setSize] = useState(() => {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(minSize, Math.min(maxSize, vmin * ratio));
  });

  useEffect(() => {
    const handleResize = () => {
      const vmin = Math.min(window.innerWidth, window.innerHeight);
      setSize(Math.max(minSize, Math.min(maxSize, vmin * ratio)));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [minSize, maxSize, ratio]);

  return size;
};
