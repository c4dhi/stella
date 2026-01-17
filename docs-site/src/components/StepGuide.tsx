import React from 'react';
import CodeBlock from '@theme/CodeBlock';

interface Step {
  number: number;
  title: string;
  description: React.ReactNode;
  code?: string;
  language?: string;
}

interface StepGuideProps {
  steps: Step[];
}

export function StepGuide({ steps }: StepGuideProps): React.ReactElement {
  return (
    <div className="step-guide">
      {steps.map((step, idx) => (
        <React.Fragment key={idx}>
          {/* Left column - step info */}
          <div className="step-guide__left">
            <div className="step-guide__indicator">
              <div className="step-guide__number">{step.number}</div>
              {idx < steps.length - 1 && <div className="step-guide__connector" />}
            </div>
            <div className="step-guide__content">
              <h3 className="step-guide__title">{step.title}</h3>
              <div className="step-guide__description">{step.description}</div>
            </div>
          </div>

          {/* Right column - code */}
          <div className="step-guide__right">
            {step.code && (
              <CodeBlock language={step.language || 'bash'}>
                {step.code}
              </CodeBlock>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function Step({
  number,
  title,
  children,
  code,
  language = 'bash',
  isLast = false
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  code?: string;
  language?: string;
  isLast?: boolean;
}): React.ReactElement {
  return (
    <div className="step">
      <div className="step__indicator">
        <div className="step__number">{number}</div>
        {!isLast && <div className="step__connector" />}
      </div>
      <div className="step__body">
        <h3 className="step__title">{title}</h3>
        <div className="step__content">{children}</div>
        {code && (
          <div className="step__code">
            <CodeBlock language={language}>{code}</CodeBlock>
          </div>
        )}
      </div>
    </div>
  );
}

export function Steps({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="steps">{children}</div>;
}

export default StepGuide;
