import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

function HeroSection() {
  return (
    <header className="hero">
      <div className="hero__container">
        <div className="hero__badge">Open Source</div>
        <h1 className="hero__title">
          Build conversational AI agents
          <span className="hero__title-accent"> that speak</span>
        </h1>
        <p className="hero__subtitle">
          STELLA is a complete platform for building, deploying, and managing
          voice-enabled AI agents with real-time WebRTC communication and
          Kubernetes orchestration.
        </p>
        <div className="hero__actions">
          <Link className="hero__button hero__button--primary" to="/docs/getting-started/quick-start">
            Get Started
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link className="hero__button hero__button--secondary" to="https://github.com/c4dhi/STELLA_backend">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </Link>
        </div>
        <div className="hero__terminal">
          <div className="hero__terminal-header">
            <span className="hero__terminal-dot hero__terminal-dot--red"></span>
            <span className="hero__terminal-dot hero__terminal-dot--yellow"></span>
            <span className="hero__terminal-dot hero__terminal-dot--green"></span>
          </div>
          <div className="hero__terminal-content">
            <code>
              <span className="hero__terminal-prompt">$</span> git clone https://github.com/c4dhi/STELLA_backend.git
              <br />
              <span className="hero__terminal-prompt">$</span> cd STELLA_backend
              <br />
              <span className="hero__terminal-prompt">$</span> ./scripts/start-k8s.sh
            </code>
          </div>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({ icon, title, description, link }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  link: string;
}) {
  return (
    <Link to={link} className="feature-card">
      <div className="feature-card__icon">{icon}</div>
      <h3 className="feature-card__title">{title}</h3>
      <p className="feature-card__description">{description}</p>
      <span className="feature-card__link">
        Learn more
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 6H11M11 6L6 1M11 6L6 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    </Link>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      ),
      title: 'Agent Orchestration',
      description: 'Deploy and manage AI agents automatically with Kubernetes. Agents scale on demand and clean up when done.',
      link: '/docs/agents/overview',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      ),
      title: 'Real-time Voice',
      description: 'WebRTC-powered voice communication with LiveKit. Low latency, high quality audio streaming.',
      link: '/docs/integration/livekit',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
      ),
      title: 'Session Management',
      description: 'Track conversations, participants, and messages. Full history and timeline views.',
      link: '/docs/getting-started/first-agent',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      ),
      title: 'Agent SDK',
      description: 'Build custom agents with our Python SDK. Full control over STT, LLM, and TTS pipelines.',
      link: '/docs/agent-sdk/overview',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      ),
      title: 'Tool Integration',
      description: 'Give agents custom tools to search databases, call APIs, and execute actions.',
      link: '/docs/agent-sdk/tools',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
          <polyline points="7.5 19.79 7.5 14.6 3 12"/>
          <polyline points="21 12 16.5 14.6 16.5 19.79"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      ),
      title: 'Production Ready',
      description: 'Deploy to any Kubernetes cluster. Built-in support for SSL, nginx, and monitoring.',
      link: '/docs/deployment/production',
    },
  ];

  return (
    <section className="features">
      <div className="features__container">
        <h2 className="features__title">Everything you need</h2>
        <p className="features__subtitle">
          A complete platform for building voice-enabled AI experiences
        </p>
        <div className="features__grid">
          {features.map((feature, idx) => (
            <FeatureCard key={idx} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="architecture">
      <div className="architecture__container">
        <div className="architecture__content">
          <h2 className="architecture__title">Built for scale</h2>
          <p className="architecture__description">
            STELLA runs on Kubernetes, automatically managing agent lifecycles.
            Each conversation gets its own isolated agent pod with dedicated resources.
          </p>
          <ul className="architecture__list">
            <li>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Auto-scaling agent pods</span>
            </li>
            <li>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Isolated environments per session</span>
            </li>
            <li>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Graceful shutdown and cleanup</span>
            </li>
            <li>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Resource limits and monitoring</span>
            </li>
          </ul>
          <Link className="architecture__link" to="/docs/deployment/kubernetes">
            View deployment guide
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </div>
        <div className="architecture__diagram">
          <pre className="architecture__code">
{`┌─────────────────────────────────────┐
│         Kubernetes Cluster          │
│  ┌─────────────────────────────┐   │
│  │     Namespace: ai-agents     │   │
│  │                              │   │
│  │  ┌────────┐  ┌────────────┐ │   │
│  │  │Postgres│  │  Backend   │ │   │
│  │  │ :5432  │  │   :3000    │ │   │
│  │  └────────┘  └────────────┘ │   │
│  │                              │   │
│  │  ┌──────────────────────┐   │   │
│  │  │    Agent Pods        │   │   │
│  │  │ ┌──────┐ ┌──────┐    │   │   │
│  │  │ │Agent1│ │Agent2│... │   │   │
│  │  │ └──────┘ └──────┘    │   │   │
│  │  └──────────────────────┘   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘`}
          </pre>
        </div>
      </div>
    </section>
  );
}

function QuickStartSection() {
  return (
    <section className="quickstart">
      <div className="quickstart__container">
        <h2 className="quickstart__title">Start in minutes</h2>
        <div className="quickstart__steps">
          <div className="quickstart__step">
            <div className="quickstart__step-number">1</div>
            <div className="quickstart__step-content">
              <h3>Clone & Configure</h3>
              <p>Set up your environment with your API keys</p>
              <div className="quickstart__code">
                <code>cp .env.example .env && nano .env</code>
              </div>
            </div>
          </div>
          <div className="quickstart__step">
            <div className="quickstart__step-number">2</div>
            <div className="quickstart__step-content">
              <h3>Deploy</h3>
              <p>Start the entire stack with one command</p>
              <div className="quickstart__code">
                <code>./scripts/start-k8s.sh</code>
              </div>
            </div>
          </div>
          <div className="quickstart__step">
            <div className="quickstart__step-number">3</div>
            <div className="quickstart__step-content">
              <h3>Create Agent</h3>
              <p>Deploy your first voice AI agent</p>
              <div className="quickstart__code">
                <code>Open http://localhost:5173</code>
              </div>
            </div>
          </div>
        </div>
        <Link className="quickstart__button" to="/docs/getting-started/quick-start">
          Read the full guide
        </Link>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="STELLA Documentation"
      description="System for Testing and Engineering LLM-based Conversational Agents">
      <main className="home">
        <HeroSection />
        <FeaturesSection />
        <ArchitectureSection />
        <QuickStartSection />
      </main>
    </Layout>
  );
}
