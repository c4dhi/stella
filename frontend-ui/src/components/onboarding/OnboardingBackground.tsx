/**
 * OnboardingBackground - Clean, minimal background for onboarding pages
 * Matches the modern dashboard style with subtle visual interest
 */
export default function OnboardingBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Solid base background matching dashboard */}
      <div className="absolute inset-0 bg-surface dark:bg-surface-dark" />

      {/* Subtle gradient accent - very light, just adds depth */}
      <div
        className="absolute inset-0 opacity-30 dark:opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(168, 85, 247, 0.08) 0%, transparent 50%)',
        }}
      />

      {/* Optional: subtle bottom gradient for depth */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background:
            'linear-gradient(to top, rgba(0, 0, 0, 0.02) 0%, transparent 30%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-0 dark:opacity-30"
        style={{
          background:
            'linear-gradient(to top, rgba(0, 0, 0, 0.15) 0%, transparent 30%)',
        }}
      />
    </div>
  );
}
