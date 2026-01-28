import { motion, HTMLMotionProps } from 'framer-motion';

interface StellaBrandingProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  /** Show the subtitle tagline */
  showTagline?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * StellaBranding - Clean STELLA logo matching dashboard header style
 */
export default function StellaBranding({
  showTagline = true,
  size = 'md',
  className = '',
  ...motionProps
}: StellaBrandingProps) {
  const sizeClasses = {
    sm: 'text-xl sm:text-2xl',
    md: 'text-2xl sm:text-3xl',
    lg: 'text-3xl sm:text-4xl',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`text-center mb-8 ${className}`}
      {...motionProps}
    >
      <h1
        className={`
          ${sizeClasses[size]}
          font-semibold
          tracking-tight
          text-content dark:text-content-inverse
          mb-1
        `}
      >
        STELLA
      </h1>
      {showTagline && (
        <p className="text-content-tertiary dark:text-content-inverse-tertiary text-xs">
          System for Testing and Engineering LLM-based conversational Agents
        </p>
      )}
    </motion.div>
  );
}
