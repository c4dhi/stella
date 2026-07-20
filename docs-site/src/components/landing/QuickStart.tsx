import { useState } from 'react';
import Link from '@docusaurus/Link';
import { ArrowRight } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

const steps = [
  {
    number: 1,
    title: 'Get STELLA',
    description: 'Clone the repository onto your own computer or server',
    lines: [1, 2],
  },
  {
    number: 2,
    title: 'Run One Command',
    description: 'The setup wizard runs on first launch—no technical background needed',
    lines: [4, 5, 6],
  },
  {
    number: 3,
    title: 'Configure Anytime',
    description: 'Keys, environments and backups are all handled through our scripts',
    lines: [8, 9, 10],
  },
];

const terminalLines = [
  { line: 1, text: 'git clone https://github.com/c4dhi/stella.git', type: 'command' },
  { line: 2, text: 'cd stella', type: 'command' },
  { line: 3, text: '', type: 'empty' },
  { line: 4, text: '# First launch runs the setup wizard', type: 'comment' },
  { line: 5, text: './scripts/start-k8s.sh', type: 'command' },
  { line: 6, text: '✓ STELLA is running at http://localhost:3000', type: 'success' },
  { line: 7, text: '', type: 'empty' },
  { line: 8, text: "# Reconfigure anytime — it's all scripted", type: 'comment' },
  { line: 9, text: './scripts/start-k8s.sh --setup', type: 'command' },
  { line: 10, text: './scripts/start-k8s.sh --config', type: 'command' },
];

const QuickStart = () => {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const isLineHighlighted = (lineNum: number) => {
    if (activeStep === null) return false;
    const step = steps.find((s) => s.number === activeStep);
    return step?.lines.includes(lineNum);
  };

  return (
    <section id="quick-start" className="section-dark">
      <div className="section-container">
        <AnimatedSection animation="fade-up">
          <div className="section-header">
            <div className="landing-eyebrow">
              Install / <span className="landing-eyebrow-path">one command</span>
            </div>
            <h2 className="section-title">Quick Start</h2>
            <p className="section-subtitle">Run it on your own hardware—no technical background, just one command</p>
          </div>
        </AnimatedSection>

        <div className="quickstart-grid">
          {/* Steps */}
          <AnimatedSection animation="fade-right" delay={100}>
            <div className="quickstart-steps">
              <div className="quickstart-step-list">
                {steps.map((step) => (
                  <div
                    key={step.number}
                    className={`quickstart-step ${activeStep === step.number ? 'quickstart-step--active' : ''}`}
                    onMouseEnter={() => setActiveStep(step.number)}
                    onMouseLeave={() => setActiveStep(null)}
                  >
                    <div className="quickstart-step-inner">
                      <div className={`quickstart-step-number ${activeStep === step.number ? 'quickstart-step-number--active' : ''}`}>
                        {step.number}
                      </div>
                      <div>
                        <h3 className="quickstart-step-title">{step.title}</h3>
                        <p className="quickstart-step-desc">{step.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Read Full Guide Link */}
              <Link to="/docs/guides/getting-started" className="quickstart-link">
                Read the full guide
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </AnimatedSection>

          {/* Terminal */}
          <AnimatedSection animation="fade-left" delay={200}>
          <div className="quickstart-terminal">
            <div className="terminal-header">
              <div className="terminal-dot terminal-dot--red" />
              <div className="terminal-dot terminal-dot--yellow" />
              <div className="terminal-dot terminal-dot--green" />
              <span className="terminal-title">terminal</span>
            </div>
            <div className="terminal-content">
              {terminalLines.map((item) => (
                <div
                  key={item.line}
                  className={`terminal-line ${isLineHighlighted(item.line) ? 'terminal-line--highlight' : ''}`}
                >
                  {item.type === 'empty' && <div className="terminal-empty" />}
                  {item.type === 'comment' && (
                    <span className="terminal-comment">{item.text}</span>
                  )}
                  {item.type === 'command' && (
                    <div className="terminal-command">
                      <span className="terminal-prompt">$</span>
                      <span>{item.text}</span>
                    </div>
                  )}
                  {item.type === 'success' && (
                    <span className="terminal-success">{item.text}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
};

export default QuickStart;
