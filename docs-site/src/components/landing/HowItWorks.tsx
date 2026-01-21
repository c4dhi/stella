import { useState, useEffect } from 'react';
import { Link2, Play, Mic, Bot, CheckCircle } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

const steps = [
  {
    icon: Link2,
    title: 'Share Link',
    description: 'Send your unique agent URL to users. No app downloads or sign-ups required.',
  },
  {
    icon: Play,
    title: 'Session Starts',
    description: 'STELLA auto-provisions a dedicated session with WebRTC connection.',
  },
  {
    icon: Mic,
    title: 'User Speaks',
    description: 'Voice is captured and streamed in real-time with echo cancellation.',
  },
  {
    icon: Bot,
    title: 'Agent Responds',
    description: 'Speech-to-text, LLM processing, and text-to-speech in one pipeline.',
  },
  {
    icon: CheckCircle,
    title: 'Session Ends',
    description: 'Resources are automatically cleaned up when the conversation ends.',
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
            <h2 className="section-title">How It Works</h2>
            <p className="section-subtitle">
              Share a link, let users talk—STELLA handles the rest
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
