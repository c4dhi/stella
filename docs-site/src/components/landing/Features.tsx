import {
  Workflow,
  Server,
  ShieldCheck,
  Mic,
  ClipboardList,
  Languages,
  ArrowRight
} from 'lucide-react';
import Link from '@docusaurus/Link';
import { AnimatedSection } from './AnimatedSection';

const features = [
  {
    icon: Workflow,
    tag: 'no-code',
    title: 'Design Without Code',
    description: 'Build your conversation in a visual editor: define the stages, what to ask, and what to collect. No programming required.',
    link: '/docs/plan-structure/plan-builder',
  },
  {
    icon: Server,
    tag: 'self-hosted',
    title: 'Runs on Your Hardware',
    description: 'One command starts STELLA on your own computer or server—no cloud account, no DevOps, no technical background needed.',
    link: '/docs/guides/getting-started',
  },
  {
    icon: ShieldCheck,
    tag: 'privacy',
    title: 'Your Data Stays Yours',
    description: 'Self-hosted by design. Participant recordings and transcripts never leave your infrastructure, with encryption at rest.',
    link: '/docs/deployment/backup-restore',
  },
  {
    icon: Mic,
    tag: 'real-time',
    title: 'Natural Voice Conversations',
    description: 'Low-latency speech with human-like turn-taking—participants can interrupt and the agent responds gracefully.',
    link: '/docs/integration/livekit',
  },
  {
    icon: ClipboardList,
    tag: 'structured',
    title: 'Structured Data Capture',
    description: 'The agent gathers exactly the information you defined and saves it alongside full transcripts—ready for analysis.',
    link: '/docs/plan-structure/deliverables',
  },
  {
    icon: Languages,
    tag: 'browser-based',
    title: 'Share a Link, No Installs',
    description: 'Participants join in their browser—no app, no signup. Multilingual conversations supported out of the box.',
    link: '/docs/architecture/session-lifecycle',
  },
];

const Features = () => {
  return (
    <section id="features" className="features-section">
      <div className="features-container">
        <AnimatedSection animation="fade-up">
          <div className="features-header">
            <div className="landing-eyebrow">
              Platform / <span className="landing-eyebrow-path">capabilities</span>
            </div>
            <h2 className="features-title">
              Everything you need to run voice studies
            </h2>
            <p className="features-subtitle">
              From designing the conversation to capturing the data—built for researchers, no technical background required
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
                  <feature.icon className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div className="feature-card-tag">[ {feature.tag} ]</div>
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
