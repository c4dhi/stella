import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, ExternalLink, ArrowRight } from 'lucide-react';
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
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);

  const canProceed = termsChecked && privacyChecked;

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
            <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-xl font-medium text-content dark:text-content-inverse mb-2">
              Welcome, {participantName}
            </h2>
            <p className="text-content-secondary dark:text-content-inverse-secondary text-sm">
              Before joining the session, please review and accept our terms.
            </p>
          </div>

          {/* Checkboxes */}
          <div className="space-y-4 mb-8">
            {/* Terms of Service */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={termsChecked}
                  onChange={(e) => setTermsChecked(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`
                    w-5 h-5 rounded border-2 transition-all duration-200
                    ${
                      termsChecked
                        ? 'bg-neutral-900 dark:bg-primary-500 border-neutral-900 dark:border-primary-500'
                        : 'border-border-secondary dark:border-border-dark-secondary group-hover:border-content-tertiary dark:group-hover:border-content-inverse-tertiary'
                    }
                  `}
                >
                  {termsChecked && (
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
                I agree to the{' '}
                <a
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-900 dark:text-primary-400 hover:text-neutral-700 dark:hover:text-primary-300 inline-flex items-center gap-1 font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Terms of Service
                  <ExternalLink className="w-3 h-3" />
                </a>
              </span>
            </label>

            {/* Privacy Policy */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={privacyChecked}
                  onChange={(e) => setPrivacyChecked(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`
                    w-5 h-5 rounded border-2 transition-all duration-200
                    ${
                      privacyChecked
                        ? 'bg-neutral-900 dark:bg-primary-500 border-neutral-900 dark:border-primary-500'
                        : 'border-border-secondary dark:border-border-dark-secondary group-hover:border-content-tertiary dark:group-hover:border-content-inverse-tertiary'
                    }
                  `}
                >
                  {privacyChecked && (
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
                I agree to the{' '}
                <a
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-900 dark:text-primary-400 hover:text-neutral-700 dark:hover:text-primary-300 inline-flex items-center gap-1 font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Privacy Policy
                  <ExternalLink className="w-3 h-3" />
                </a>
              </span>
            </label>
          </div>

          {/* Continue Button */}
          <GradientButton onClick={onAccept} disabled={!canProceed}>
            <span>Continue</span>
            <ArrowRight
              className={`w-4 h-4 transition-transform ${canProceed ? 'group-hover:translate-x-1' : ''}`}
            />
          </GradientButton>
        </OnboardingCard>
      </div>
    </OnboardingLayout>
  );
}
