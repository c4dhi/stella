import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Loader2, Sparkles, Check } from 'lucide-react';
import { apiClient } from '../services/ApiClient';
import type { PublicProjectInfo, JoinProgressResponse } from '../lib/api-types';
import Cookies from 'js-cookie';
import {
  OnboardingLayout,
  OnboardingCard,
  StellaBranding,
  GradientButton,
} from '../components/onboarding';

// Cookie configuration
const COOKIE_PREFIX = 'stella_public_';
const COOKIE_EXPIRY_DAYS = 365;

// State machine states
type PageState =
  | 'LOADING'
  | 'ERROR'
  | 'READY' // Ready to join, show waiting screen
  | 'JOINING' // SSE-based joining with progress updates
  | 'REDIRECTING'; // Redirecting to /join/:invitationToken

// Polling configuration
const POLL_INTERVAL_MS = 500;

export default function PublicProjectJoinPage() {
  const { publicToken } = useParams<{ publicToken: string }>();
  const navigate = useNavigate();

  // State machine
  const [pageState, setPageState] = useState<PageState>('LOADING');
  const [error, setError] = useState<string | null>(null);

  // Project info
  const [projectInfo, setProjectInfo] = useState<PublicProjectInfo | null>(
    null,
  );

  // Remember session checkbox - defaults to false, user must explicitly opt-in
  const [rememberSession, setRememberSession] = useState(false);

  // Join progress tracking
  const [progress, setProgress] = useState<JoinProgressResponse>({
    step: 0,
    totalSteps: 5,
    status: 'in_progress',
    message: 'Starting...',
  });

  // Polling cleanup ref
  const pollingRef = useRef<{ active: boolean }>({ active: false });

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.active = false;
    };
  }, []);

  // Check for existing cookie and redirect if found
  useEffect(() => {
    if (!publicToken) {
      setError('Invalid public project link');
      setPageState('ERROR');
      return;
    }

    // Check for existing invitation token in cookie
    const existingToken = Cookies.get(`${COOKIE_PREFIX}${publicToken}`);
    if (existingToken) {
      // Redirect directly to existing invitation
      navigate(`/join/${existingToken}`, { replace: true });
      return;
    }

    // Load project info
    const loadProjectInfo = async () => {
      try {
        const info = await apiClient.getPublicProject(publicToken);
        setProjectInfo(info);

        // Check for errors
        if (!info.isEnabled) {
          setError(
            'This session is no longer accepting new participants. Please contact the organizer for more information.',
          );
          setPageState('ERROR');
          return;
        }

        if (info.isExpired) {
          setError('This public project link has expired.');
          setPageState('ERROR');
          return;
        }

        setPageState('READY');
      } catch (err: any) {
        console.error('Failed to load public project:', err);
        if (err.statusCode === 404) {
          setError('Public project not found. The link may be invalid.');
        } else {
          setError(err.message || 'Failed to load project');
        }
        setPageState('ERROR');
      }
    };

    loadProjectInfo();
  }, [publicToken, navigate]);

  // Handle join button click - uses polling for progress
  const handleJoin = useCallback(async () => {
    if (!publicToken) return;

    setPageState('JOINING');
    setProgress({
      step: 0,
      totalSteps: 5,
      status: 'in_progress',
      message: 'Connecting...',
    });

    try {
      // Start the join process (non-blocking)
      const { sessionId } = await apiClient.startJoinPublicProject(publicToken);

      // Start polling for progress
      pollingRef.current.active = true;

      const poll = async () => {
        if (!pollingRef.current.active) return;

        try {
          const status = await apiClient.getJoinProgress(
            publicToken,
            sessionId,
          );
          setProgress(status);

          // Handle completion
          if (status.status === 'complete' && status.invitationToken) {
            pollingRef.current.active = false;

            // Save invitation token to cookie if "remember" is checked
            if (rememberSession) {
              Cookies.set(
                `${COOKIE_PREFIX}${publicToken}`,
                status.invitationToken,
                {
                  expires: COOKIE_EXPIRY_DAYS,
                  sameSite: 'lax',
                },
              );
            }

            setPageState('REDIRECTING');
            navigate(`/join/${status.invitationToken}`, { replace: true });
            return;
          }

          // Handle failure
          if (status.status === 'failed') {
            pollingRef.current.active = false;
            setError(status.error || 'Failed to join. Please try again.');
            setPageState('ERROR');
            return;
          }

          // Continue polling if still in progress
          if (pollingRef.current.active) {
            setTimeout(poll, POLL_INTERVAL_MS);
          }
        } catch (err: any) {
          console.error('Failed to get join progress:', err);
          // Continue polling even on error (transient network issues)
          if (pollingRef.current.active) {
            setTimeout(poll, POLL_INTERVAL_MS * 2); // Slow down on error
          }
        }
      };

      // Start polling
      poll();
    } catch (err: any) {
      console.error('Failed to start joining public project:', err);
      setError(err.message || 'Failed to join. Please try again.');
      setPageState('ERROR');
    }
  }, [publicToken, rememberSession, navigate]);

  return (
    <AnimatePresence mode="wait">
      {/* LOADING State */}
      {pageState === 'LOADING' && (
        <OnboardingLayout key="loading">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center"
          >
            <Loader2 className="w-8 h-8 animate-spin text-neutral-400 dark:text-primary-400 mx-auto mb-4" />
            <p className="text-content-secondary dark:text-content-inverse-secondary text-sm">
              Loading...
            </p>
          </motion.div>
        </OnboardingLayout>
      )}

      {/* ERROR State */}
      {pageState === 'ERROR' && (
        <OnboardingLayout key="error">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-md w-full"
          >
            {/* STELLA Branding */}
            <StellaBranding />

            {/* Error Card */}
            <OnboardingCard contentClassName="p-8">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mb-4">
                  <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-lg font-medium text-content dark:text-content-inverse mb-2">
                  Unable to Access
                </h2>
                <p className="text-content-secondary dark:text-content-inverse-secondary text-sm">
                  {error}
                </p>
              </div>
            </OnboardingCard>
          </motion.div>
        </OnboardingLayout>
      )}

      {/* READY State - Show join screen */}
      {pageState === 'READY' && projectInfo && (
        <OnboardingLayout key="ready">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-md w-full"
          >
            {/* STELLA Branding */}
            <StellaBranding />

            {/* Join Card */}
            <OnboardingCard contentClassName="p-8">
              <div className="flex flex-col items-center text-center">
                {/* Agent Icon */}
                <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-500/10 flex items-center justify-center mb-4 border border-border dark:border-border-dark">
                  <span className="text-3xl">
                    {projectInfo.agentIcon || '🤖'}
                  </span>
                </div>

                {/* Project Name */}
                <h2 className="text-xl font-medium text-content dark:text-content-inverse mb-2">
                  {projectInfo.projectName}
                </h2>

                {/* Agent Name */}
                <p className="text-content-secondary dark:text-content-inverse-secondary text-sm mb-6">
                  Powered by {projectInfo.agentName}
                </p>

                {/* Remember Session Checkbox */}
                <label className="flex items-center gap-3 cursor-pointer mb-6 text-sm text-content-secondary dark:text-content-inverse-secondary hover:text-content dark:hover:text-content-inverse transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberSession}
                    onChange={(e) => setRememberSession(e.target.checked)}
                    className="w-4 h-4 rounded border-border-secondary dark:border-border-dark-secondary bg-white dark:bg-surface-dark-secondary text-neutral-900 dark:text-primary-500 focus:ring-neutral-900 dark:focus:ring-primary-500 focus:ring-offset-0"
                  />
                  Remember my session on this device
                </label>

                {/* Join Button */}
                <GradientButton onClick={handleJoin}>
                  <Sparkles className="w-5 h-5" />
                  <span>Start Session</span>
                </GradientButton>

                <p className="text-content-tertiary dark:text-content-inverse-tertiary text-xs mt-4">
                  A private session will be created just for you
                </p>
              </div>
            </OnboardingCard>
          </motion.div>
        </OnboardingLayout>
      )}

      {/* JOINING State - Creating session with progress updates */}
      {pageState === 'JOINING' && projectInfo && (
        <OnboardingLayout key="joining">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-md w-full"
          >
            {/* STELLA Branding */}
            <StellaBranding />

            {/* Preparing Card */}
            <OnboardingCard contentClassName="p-8">
              <div className="flex flex-col items-center text-center">
                {/* Agent Icon with spinner */}
                <div className="relative w-16 h-16 mb-6">
                  <div className="absolute inset-0 rounded-full bg-primary-100 dark:bg-primary-500/10 flex items-center justify-center border border-border dark:border-border-dark">
                    <span className="text-3xl">
                      {projectInfo.agentIcon || '🤖'}
                    </span>
                  </div>
                  {/* Spinning ring */}
                  <div className="absolute -inset-1 rounded-full border-2 border-transparent border-t-primary-500 dark:border-t-primary-400 animate-spin" />
                </div>

                <h2 className="text-xl font-medium text-content dark:text-content-inverse mb-2">
                  {progress.message}
                </h2>

                <p className="text-content-secondary dark:text-content-inverse-secondary text-sm mb-6">
                  {projectInfo.agentName} is getting ready...
                </p>

                {/* Step dots */}
                <div className="flex gap-2 mb-4">
                  {Array.from(
                    { length: progress.totalSteps },
                    (_, i) => i + 1,
                  ).map((s) => (
                    <motion.div
                      key={s}
                      className={`w-3 h-3 rounded-full flex items-center justify-center transition-colors duration-300 ${
                        s < progress.step
                          ? 'bg-emerald-500'
                          : s === progress.step
                            ? 'bg-neutral-900 dark:bg-primary-500'
                            : 'bg-neutral-200 dark:bg-neutral-700'
                      }`}
                      initial={false}
                      animate={{
                        scale: s === progress.step ? [1, 1.2, 1] : 1,
                      }}
                      transition={{
                        duration: 0.5,
                        repeat: s === progress.step ? Infinity : 0,
                        repeatType: 'reverse',
                      }}
                    >
                      {s < progress.step && (
                        <Check className="w-2 h-2 text-white" />
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-neutral-900 dark:bg-primary-500"
                    initial={{ width: '0%' }}
                    animate={{
                      width: `${(progress.step / progress.totalSteps) * 100}%`,
                    }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>

                <p className="text-content-tertiary dark:text-content-inverse-tertiary text-xs mt-4">
                  Step {progress.step || 1} of {progress.totalSteps}
                </p>
              </div>
            </OnboardingCard>
          </motion.div>
        </OnboardingLayout>
      )}

      {/* REDIRECTING State */}
      {pageState === 'REDIRECTING' && (
        <OnboardingLayout key="redirecting">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center"
          >
            <Loader2 className="w-8 h-8 animate-spin text-neutral-400 dark:text-primary-400 mx-auto mb-4" />
            <p className="text-content-secondary dark:text-content-inverse-secondary text-sm">
              Connecting to your session...
            </p>
          </motion.div>
        </OnboardingLayout>
      )}
    </AnimatePresence>
  );
}
