import { Link2, Play, Mic, Bot, CheckCircle } from 'lucide-react';

const steps = [
  {
    icon: Link2,
    title: 'Share Link',
    description: 'User clicks',
  },
  {
    icon: Play,
    title: 'Session Starts',
    description: 'Auto-provisioned',
  },
  {
    icon: Mic,
    title: 'User Speaks',
    description: 'WebRTC stream',
  },
  {
    icon: Bot,
    title: 'Agent Responds',
    description: 'STT → LLM → TTS',
  },
  {
    icon: CheckCircle,
    title: 'Session Ends',
    description: 'Auto-cleanup',
  },
];

const HowItWorks = () => {
  return (
    <section className="section-dark section-alt">
      <div className="section-container">
        <div className="section-header">
          <h2 className="section-title">How It Works</h2>
          <p className="section-subtitle">
            Share a link, let users talk—STELLA handles the rest
          </p>
        </div>

        <div className="howitworks-content">
          {/* Connection Line */}
          <div className="howitworks-line" />

          <div className="howitworks-grid">
            {steps.map((step, index) => (
              <div key={step.title} className="howitworks-step">
                {/* Step Number */}
                <div className="howitworks-number">{index + 1}</div>

                {/* Icon */}
                <div className="howitworks-icon">
                  <step.icon className="w-8 h-8" />
                </div>

                {/* Text */}
                <h3 className="howitworks-step-title">{step.title}</h3>
                <p className="howitworks-step-desc">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
