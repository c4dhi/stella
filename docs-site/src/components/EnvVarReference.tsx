import React from 'react';
import Link from '@docusaurus/Link';

interface EnvVarReferenceProps {
  /** Deep link to a specific category (e.g., "database", "livekit", "kubernetes") */
  category?: string;
  /** Custom link text (default: "Environment Variables Reference") */
  text?: string;
  /** Optional description shown below the link */
  description?: string;
}

/**
 * A styled reference component for linking to the Environment Variables documentation.
 * Renders as a highlighted box with a book icon.
 */
export function EnvVarReference({
  category,
  text = 'Environment Variables Reference',
  description,
}: EnvVarReferenceProps): React.ReactElement {
  const href = category
    ? `/docs/architecture/environment-variables#${category}`
    : '/docs/architecture/environment-variables';

  return (
    <div className="env-var-reference">
      <div className="env-var-reference__icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>
      <div className="env-var-reference__content">
        <Link to={href} className="env-var-reference__link">
          {text}
        </Link>
        {description && (
          <p className="env-var-reference__description">{description}</p>
        )}
      </div>
    </div>
  );
}

export default EnvVarReference;
