import React, { ReactNode, CSSProperties } from 'react';
import useScrollAnimation from '@site/src/hooks/useScrollAnimation';

type AnimationType = 'fade' | 'fade-up' | 'fade-left' | 'fade-right' | 'scale';

interface AnimatedSectionProps {
  children: ReactNode;
  animation?: AnimationType;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

export function AnimatedSection({
  children,
  animation = 'fade-up',
  delay = 0,
  className = '',
  style = {},
}: AnimatedSectionProps) {
  const { ref, isVisible } = useScrollAnimation<HTMLDivElement>({
    threshold: 0.15,
    rootMargin: '0px 0px -80px 0px',
  });

  const animationClass = `scroll-animate scroll-animate--${animation}`;
  const visibleClass = isVisible ? 'is-visible' : '';

  return (
    <div
      ref={ref}
      className={`${animationClass} ${visibleClass} ${className}`}
      style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}
    >
      {children}
    </div>
  );
}

export default AnimatedSection;
