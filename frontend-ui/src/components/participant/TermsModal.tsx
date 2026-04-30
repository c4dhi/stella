import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import {
  OnboardingLayout,
  OnboardingCard,
  StellaBranding,
  GradientButton,
} from '../onboarding';

interface TermsModalProps {
  participantName: string;
  onAccept: () => void;
}

export default function TermsModal({
  participantName,
  onAccept,
}: TermsModalProps) {
  const [instructionsChecked, setInstructionsChecked] = useState(false);

  return (
    <OnboardingLayout>
      <div className="max-w-lg w-full">
        {/* STELLA Branding */}
        <StellaBranding />

        {/* Terms Card */}
        <OnboardingCard
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          contentClassName="p-8"
        >
          {/* Welcome Header */}
          <div className="text-center mb-8">
            <h2 className="text-xl font-medium text-content dark:text-content-inverse mb-2">
              Hello
            </h2>
            <p className="text-content-secondary dark:text-content-inverse-secondary text-sm">
              Thank you for your participation
            </p>
          </div>

          {/* Checkbox */}
          <div className="space-y-4 mb-8">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={instructionsChecked}
                  onChange={(e) => setInstructionsChecked(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`
                    w-5 h-5 rounded border-2 transition-all duration-200
                    ${
                      instructionsChecked
                        ? 'bg-neutral-900 dark:bg-primary-500 border-neutral-900 dark:border-primary-500'
                        : 'border-border-secondary dark:border-border-dark-secondary group-hover:border-content-tertiary dark:group-hover:border-content-inverse-tertiary'
                    }
                  `}
                >
                  {instructionsChecked && (
                    <svg
                      className="w-full h-full text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-content-secondary dark:text-content-inverse-secondary group-hover:text-content dark:group-hover:text-content-inverse transition-colors">
                I have read the instructions on the corresponding survey
              </span>
            </label>
          </div>

          {/* Continue Button */}
          <GradientButton onClick={onAccept} disabled={!instructionsChecked}>
            <span>Continue</span>
            <ArrowRight
              className={`w-4 h-4 transition-transform ${instructionsChecked ? 'group-hover:translate-x-1' : ''}`}
            />
          </GradientButton>
        </OnboardingCard>
      </div>
    </OnboardingLayout>
  );
}
