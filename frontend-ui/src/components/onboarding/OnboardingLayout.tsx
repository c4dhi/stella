import { ReactNode } from 'react';
import OnboardingBackground from './OnboardingBackground';

interface OnboardingLayoutProps {
  children: ReactNode;
  /** Additional className for the container */
  className?: string;
}

/**
 * OnboardingLayout - Clean page wrapper matching dashboard style
 * Centers content vertically/horizontally with minimal, modern design
 */
export default function OnboardingLayout({
  children,
  className = '',
}: OnboardingLayoutProps) {
  return (
    <div
      className={`
        min-h-screen w-full
        bg-surface dark:bg-surface-dark
        text-content dark:text-content-inverse
        transition-colors duration-200
        ${className}
      `}
    >
      <OnboardingBackground />
      <div className="relative z-10 min-h-screen w-full flex items-center justify-center p-6">
        {children}
      </div>
    </div>
  );
}
