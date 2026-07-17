import { useState, useEffect } from 'react';
import { Workflow, Link2, Play, Mic, Bot, Database } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

const steps = [
  {
    icon: Workflow,
    title: 'Design the Conversation',
    description: 'Build your flow in the visual editor—stages, questions, and the data to collect. No code.',
  },
  {
    icon: Link2,
    title: 'Share a Link',
    description: 'Send participants a link. No app downloads or sign-ups required.',
  },
  {
    icon: Mic,
    title: 'Participant Speaks',
    description: 'Voice is captured and streamed in real-time with echo cancellation.',
  },
  {
    icon: Bot,
    title: 'Agent Leads',
    description: 'STELLA guides the conversation through your stages and gathers the information you defined.',
  },
  {
    icon: Database,
    title: 'Data Is Captured',
    description: 'Transcripts and structured data are saved for analysis; the session cleans up automatically.',
  },
];

// Duration each step is highlighted (in ms)
const STEP_DURATION = 3000;

const HowItWorks = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [isInView, setIsInView] = useState(false);

  // Cycle through steps when in view
  useEffect(() => {
    if (!isInView) return;

    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, STEP_DURATION);

    return () => clearInterval(interval);
  }, [isInView]);

  return (
    <section className="section-dark section-alt">
      <div className="section-container">
        <AnimatedSection animation="fade-up">
          <div className="section-header">
            <div className="landing-eyebrow">
              Flow / <span className="landing-eyebrow-path">pipeline</span>
            </div>
            <h2 className="section-title">How It Works</h2>
            <p className="section-subtitle">
              Design it, share a link, let participants talk—STELLA handles the rest
            </p>
          </div>
        </AnimatedSection>

        <AnimatedSection
          animation="fade-up"
          delay={100}
          className="howitworks-layout"
        >
          <div
            className="howitworks-inner"
            ref={(el) => {
              if (el && !isInView) {
                const observer = new IntersectionObserver(
                  ([entry]) => {
                    if (entry.isIntersecting) {
                      setIsInView(true);
                    }
                  },
                  { threshold: 0.3 }
                );
                observer.observe(el);
              }
            }}
          >
            {/* Browser Window with Video/GIF */}
            <div className="howitworks-browser">
              <div className="howitworks-browser-window">
                {/* Browser Header */}
                <div className="howitworks-browser-header">
                  <div className="howitworks-browser-dots">
                    <div className="howitworks-browser-dot howitworks-browser-dot--red" />
                    <div className="howitworks-browser-dot howitworks-browser-dot--yellow" />
                    <div className="howitworks-browser-dot howitworks-browser-dot--green" />
                  </div>
                  <div className="howitworks-browser-url">
                    <span>stella.ai/demo</span>
                  </div>
                </div>
                {/* Video/GIF Placeholder */}
                <div className="howitworks-browser-content">
                  <div className="howitworks-placeholder">
                    <Play className="howitworks-placeholder-icon" />
                    <span className="howitworks-placeholder-text">Demo Video</span>
                    <span className="howitworks-placeholder-subtext">Coming Soon</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Steps List */}
            <div className="howitworks-steps">
              {steps.map((step, index) => (
                <AnimatedSection
                  key={step.title}
                  animation="fade-left"
                  delay={150 + index * 100}
                >
                  <div
                    className={`howitworks-step ${activeStep === index ? 'howitworks-step--active' : ''}`}
                    onClick={() => setActiveStep(index)}
                  >
                    {/* Progress indicator */}
                    <div className="howitworks-step-progress">
                      <div className="howitworks-step-number">
                        {index + 1}
                      </div>
                      {index < steps.length - 1 && (
                        <div className="howitworks-step-line">
                          <div
                            className="howitworks-step-line-fill"
                            style={{
                              transform: activeStep > index ? 'scaleY(1)' : 'scaleY(0)',
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="howitworks-step-content">
                      <div className="howitworks-step-header">
                        <step.icon className="howitworks-step-icon" />
                        <h3 className="howitworks-step-title">{step.title}</h3>
                      </div>
                      <p className="howitworks-step-desc">{step.description}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
};

export default HowItWorks;
