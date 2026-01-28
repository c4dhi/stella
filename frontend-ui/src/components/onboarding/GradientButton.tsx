import { ReactNode, ButtonHTMLAttributes } from 'react';

interface GradientButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Show loading spinner */
  isLoading?: boolean;
  /** Loading text to display */
  loadingText?: string;
  /** Full width button */
  fullWidth?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Variant style */
  variant?: 'primary' | 'secondary';
}

/**
 * GradientButton - Primary action button matching dashboard style
 * Black in light mode, purple gradient in dark mode
 */
export default function GradientButton({
  children,
  isLoading = false,
  loadingText,
  fullWidth = true,
  size = 'md',
  variant = 'primary',
  className = '',
  disabled,
  ...buttonProps
}: GradientButtonProps) {
  const sizeClasses = {
    sm: 'py-2.5 px-4 text-sm',
    md: 'py-3 px-6 text-sm',
    lg: 'py-3.5 px-8 text-base',
  };

  const isDisabled = disabled || isLoading;

  const variantClasses =
    variant === 'primary'
      ? `
          bg-neutral-900 dark:bg-gradient-to-r dark:from-primary-600 dark:to-primary-500
          text-white
          hover:bg-neutral-800 dark:hover:from-primary-500 dark:hover:to-primary-400
          hover:shadow-md dark:hover:shadow-primary
          active:bg-neutral-950 dark:active:bg-primary-600
        `
      : `
          bg-surface-secondary dark:bg-surface-dark-secondary
          text-content dark:text-content-inverse
          border border-border dark:border-border-dark
          hover:bg-surface-tertiary dark:hover:bg-surface-dark-tertiary
          hover:border-border-secondary dark:hover:border-border-dark-secondary
        `;

  return (
    <button
      className={`
        ${fullWidth ? 'w-full' : ''}
        ${sizeClasses[size]}
        ${variantClasses}
        relative overflow-hidden group
        font-medium
        rounded-lg
        transition-all duration-200 ease-smooth
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none
        ${className}
      `}
      disabled={isDisabled}
      {...buttonProps}
    >
      <div className="relative z-10 flex items-center justify-center gap-2">
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>{loadingText || 'Loading...'}</span>
          </>
        ) : (
          children
        )}
      </div>
    </button>
  );
}
