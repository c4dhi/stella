import { ReactNode } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface OnboardingCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Show subtle shadow/glow effect */
  elevated?: boolean;
  /** Additional className for the card content wrapper */
  contentClassName?: string;
}

/**
 * OnboardingCard - Clean card wrapper matching dashboard style
 * Uses solid background with subtle border and shadow
 */
export default function OnboardingCard({
  children,
  elevated = true,
  className = '',
  contentClassName = '',
  ...motionProps
}: OnboardingCardProps) {
  return (
    <motion.div className={`relative ${className}`} {...motionProps}>
      {/* Card content */}
      <div
        className={`
          bg-white dark:bg-surface-dark-secondary
          border border-border dark:border-border-dark
          rounded-2xl
          ${elevated ? 'shadow-lg dark:shadow-dark-lg' : 'shadow-sm dark:shadow-dark'}
          p-6 sm:p-8
          ${contentClassName}
        `}
      >
        {children}
      </div>
    </motion.div>
  );
}
