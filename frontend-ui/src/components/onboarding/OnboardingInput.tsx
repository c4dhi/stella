import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';

interface OnboardingInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label text */
  label: string;
  /** Optional end adornment (e.g., visibility toggle) */
  endAdornment?: ReactNode;
  /** Error state */
  error?: boolean;
}

/**
 * OnboardingInput - Form input matching dashboard input-field style
 */
const OnboardingInput = forwardRef<HTMLInputElement, OnboardingInputProps>(
  ({ label, endAdornment, error, className = '', ...inputProps }, ref) => {
    return (
      <div className="space-y-2 group">
        <label className="text-xs font-medium tracking-wider uppercase ml-1 transition-colors text-content-secondary dark:text-content-inverse-tertiary group-focus-within:text-neutral-900 dark:group-focus-within:text-primary-400">
          {label}
        </label>
        <div
          className={`
            relative transition-all duration-200 rounded-lg
            border
            ${
              error
                ? 'border-red-400 dark:border-red-500'
                : 'border-border dark:border-border-dark'
            }
            bg-white dark:bg-surface-dark-secondary
            hover:border-border-secondary dark:hover:border-border-dark-secondary
            focus-within:border-neutral-900 dark:focus-within:border-primary-400
            focus-within:ring-2 focus-within:ring-neutral-900/20 dark:focus-within:ring-primary-400/20
          `}
        >
          <input
            ref={ref}
            className={`
              w-full bg-transparent border-none
              px-3.5 py-2.5
              text-body
              text-content dark:text-content-inverse
              placeholder-content-tertiary dark:placeholder-content-inverse-tertiary
              focus:ring-0 focus:outline-none
              ${endAdornment ? 'pr-12' : ''}
              ${className}
            `}
            {...inputProps}
          />
          {endAdornment && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {endAdornment}
            </div>
          )}
        </div>
      </div>
    );
  },
);

OnboardingInput.displayName = 'OnboardingInput';

export default OnboardingInput;
