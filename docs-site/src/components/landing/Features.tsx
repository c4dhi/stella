import {
  Radio,
  Puzzle,
  Wrench,
  Network,
  Server,
  Layers,
  ArrowRight
} from 'lucide-react';
import Link from '@docusaurus/Link';
import { AnimatedSection } from './AnimatedSection';

const features = [
  {
    icon: Radio,
    title: 'Real-time Voice',
    description: 'Full audio pipeline included: STT, TTS, WebRTC streaming, echo cancellation, and noise suppression—all handled by STELLA.',
    link: '/docs/integration/livekit',
  },
  {
    icon: Puzzle,
    title: 'Modular Agents',
    description: 'Use pre-built agents or build your own. Swap STT, LLM, and TTS providers without touching infrastructure code.',
    link: '/docs/guides/build-your-own-agent',
  },
  {
    icon: Wrench,
    title: 'Tool Calling',
    description: 'Agents execute functions based on context—search databases, call APIs, trigger workflows.',
    link: '/docs/sdk/tools',
  },
  {
    icon: Network,
    title: 'Full Session Orchestration',
    description: 'Share a link and let users talk to your agent instantly. The system handles session creation, state management, and cleanup automatically.',
    link: '/docs/architecture/session-lifecycle',
  },
  {
    icon: Server,
    title: 'Microservice Architecture',
    description: 'Built on Kubernetes with efficient inter-service communication. Auto-scaling, isolated sessions, and resource management.',
    link: '/docs/architecture/kubernetes-orchestration',
  },
  {
    icon: Layers,
    title: 'Multimodal Streaming',
    description: 'A unified multimodal timeline for audio, video, text, and events. Ultra-low latency—playback begins before the full response is generated.',
    link: '/docs/sdk/streaming',
  },
];

const Features = () => {
  return (
    <section id="features" className="features-section">
      <div className="features-container">
        <AnimatedSection animation="fade-up">
          <div className="features-header">
            <h2 className="features-title">
              Everything you need to build voice AI
            </h2>
            <p className="features-subtitle">
              A complete platform for building, deploying, and scaling conversational AI agents
            </p>
          </div>
        </AnimatedSection>

        <div className="features-grid">
          {features.map((feature, index) => (
            <AnimatedSection
              key={feature.title}
              animation="fade-up"
              delay={index * 100}
            >
              <Link
                to={feature.link}
                className="feature-card"
              >
                <div className="feature-card-icon">
                  <feature.icon className="w-6 h-6" />
                </div>
                <h3 className="feature-card-title">{feature.title}</h3>
                <p className="feature-card-description">
                  {feature.description}
                </p>
                <div className="feature-card-link">
                  Learn more
                  <ArrowRight className="ml-1 w-4 h-4" />
                </div>
              </Link>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
