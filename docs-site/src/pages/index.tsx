import React, { useState } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

// stella-agent Pipeline Diagram
function StellaAgentDiagram() {
  return (
    <svg viewBox="0 0 280 320" className="pipeline-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* User Input */}
      <g className="pipeline-node pipeline-node--input">
        <rect x="90" y="8" width="100" height="32" rx="16" />
        <text x="140" y="28" textAnchor="middle">User Input</text>
      </g>

      {/* Arrow down */}
      <path d="M140 40 L140 56" className="pipeline-arrow" markerEnd="url(#arrowhead)" />

      {/* InputGate */}
      <g className="pipeline-node pipeline-node--primary">
        <rect x="20" y="60" width="240" height="56" rx="8" />
        <text x="140" y="82" textAnchor="middle" className="pipeline-node__title">InputGate</text>
        <text x="140" y="100" textAnchor="middle" className="pipeline-node__subtitle">Routes SAFE → response, UNSAFE → experts</text>
      </g>

      {/* Arrow down */}
      <path d="M140 116 L140 132" className="pipeline-arrow" markerEnd="url(#arrowhead)" />

      {/* UNSAFE label */}
      <text x="160" y="128" className="pipeline-label">if UNSAFE</text>

      {/* ExpertPool */}
      <g className="pipeline-node pipeline-node--secondary">
        <rect x="20" y="136" width="240" height="56" rx="8" />
        <text x="140" y="158" textAnchor="middle" className="pipeline-node__title">ExpertPool</text>
        <text x="140" y="176" textAnchor="middle" className="pipeline-node__subtitle">Parallel domain expert consultation</text>
      </g>

      {/* Arrow down */}
      <path d="M140 192 L140 208" className="pipeline-arrow" markerEnd="url(#arrowhead)" />

      {/* Aggregator */}
      <g className="pipeline-node pipeline-node--secondary">
        <rect x="20" y="212" width="240" height="56" rx="8" />
        <text x="140" y="234" textAnchor="middle" className="pipeline-node__title">Aggregator</text>
        <text x="140" y="252" textAnchor="middle" className="pipeline-node__subtitle">Synthesizes expert findings</text>
      </g>

      {/* Arrow down */}
      <path d="M140 268 L140 284" className="pipeline-arrow" markerEnd="url(#arrowhead)" />

      {/* Response */}
      <g className="pipeline-node pipeline-node--output">
        <rect x="70" y="288" width="140" height="28" rx="14" />
        <text x="140" y="306" textAnchor="middle">Response + State</text>
      </g>

      {/* Arrow marker definition */}
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="pipeline-arrowhead" />
        </marker>
      </defs>
    </svg>
  );
}

// stella-light Pipeline Diagram
function StellaLightDiagram() {
  return (
    <svg viewBox="0 0 280 280" className="pipeline-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* User Input */}
      <g className="pipeline-node pipeline-node--input">
        <rect x="90" y="8" width="100" height="32" rx="16" />
        <text x="140" y="28" textAnchor="middle">User Input</text>
      </g>

      {/* Arrow down */}
      <path d="M140 40 L140 56" className="pipeline-arrow" markerEnd="url(#arrowhead2)" />

      {/* Phase 1: LLM */}
      <g className="pipeline-node pipeline-node--primary">
        <rect x="20" y="60" width="240" height="48" rx="8" />
        <text x="140" y="82" textAnchor="middle" className="pipeline-node__title">Phase 1: LLM Call</text>
        <text x="140" y="98" textAnchor="middle" className="pipeline-node__subtitle">Streams text to TTS immediately</text>
      </g>

      {/* Split arrows */}
      <path d="M140 108 L140 124 L80 124 L80 140" className="pipeline-arrow" markerEnd="url(#arrowhead2)" />
      <path d="M140 108 L140 124 L200 124 L200 140" className="pipeline-arrow" markerEnd="url(#arrowhead2)" />

      {/* Parallel label */}
      <text x="140" y="134" textAnchor="middle" className="pipeline-label">parallel</text>

      {/* TTS Playback */}
      <g className="pipeline-node pipeline-node--highlight">
        <rect x="20" y="144" width="120" height="48" rx="8" />
        <text x="80" y="164" textAnchor="middle" className="pipeline-node__title">TTS Playback</text>
        <text x="80" y="180" textAnchor="middle" className="pipeline-node__subtitle">User hears audio</text>
      </g>

      {/* Phase 2: Tools */}
      <g className="pipeline-node pipeline-node--secondary">
        <rect x="148" y="144" width="112" height="48" rx="8" />
        <text x="204" y="164" textAnchor="middle" className="pipeline-node__title">Phase 2: Tools</text>
        <text x="204" y="180" textAnchor="middle" className="pipeline-node__subtitle">State updates</text>
      </g>

      {/* Merge arrows */}
      <path d="M80 192 L80 208 L140 208 L140 224" className="pipeline-arrow" />
      <path d="M204 192 L204 208 L140 208" className="pipeline-arrow" />
      <path d="M140 208 L140 224" className="pipeline-arrow" markerEnd="url(#arrowhead2)" />

      {/* Response */}
      <g className="pipeline-node pipeline-node--output">
        <rect x="60" y="228" width="160" height="28" rx="14" />
        <text x="140" y="246" textAnchor="middle">Response Complete</text>
      </g>

      {/* Arrow marker definition */}
      <defs>
        <marker id="arrowhead2" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" className="pipeline-arrowhead" />
        </marker>
      </defs>
    </svg>
  );
}

// Kubernetes Architecture Diagram
function KubernetesArchitectureDiagram() {
  return (
    <svg viewBox="0 0 440 340" className="k8s-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* Kubernetes Cluster outer border */}
      <rect x="12" y="12" width="416" height="316" rx="12" className="k8s-cluster" />
      <text x="220" y="38" textAnchor="middle" className="k8s-cluster__label">Kubernetes Cluster</text>

      {/* Namespace */}
      <rect x="28" y="56" width="384" height="256" rx="8" className="k8s-namespace" />
      <text x="220" y="80" textAnchor="middle" className="k8s-namespace__label">namespace: ai-agents</text>

      {/* Top row: Postgres + Backend + LiveKit */}
      <g className="k8s-pod k8s-pod--service">
        <rect x="44" y="100" width="110" height="60" rx="6" />
        <g className="k8s-pod__icon">
          <circle cx="66" cy="122" r="10" />
          <rect x="60" y="118" width="12" height="8" rx="1" />
        </g>
        <text x="86" y="124" className="k8s-pod__name">PostgreSQL</text>
        <text x="86" y="142" className="k8s-pod__port">:5432</text>
      </g>

      <g className="k8s-pod k8s-pod--service">
        <rect x="168" y="100" width="130" height="60" rx="6" />
        <g className="k8s-pod__icon">
          <rect x="186" y="116" width="16" height="16" rx="2" />
          <path d="M190 120 L198 120 M190 124 L198 124 M190 128 L196 128" strokeWidth="1.5" />
        </g>
        <text x="212" y="124" className="k8s-pod__name">Backend API</text>
        <text x="212" y="142" className="k8s-pod__port">:3000</text>
      </g>

      <g className="k8s-pod k8s-pod--service">
        <rect x="312" y="100" width="84" height="60" rx="6" />
        <g className="k8s-pod__icon">
          <circle cx="334" cy="122" r="8" />
          <circle cx="342" cy="130" r="8" />
        </g>
        <text x="358" y="124" className="k8s-pod__name">LiveKit</text>
        <text x="358" y="142" className="k8s-pod__port">:7880</text>
      </g>

      {/* Agent Pods section */}
      <rect x="44" y="180" width="352" height="116" rx="6" className="k8s-agents-container" />
      <text x="220" y="204" textAnchor="middle" className="k8s-agents__label">Agent Pods (auto-scaled)</text>

      {/* Individual agent pods */}
      <g className="k8s-pod k8s-pod--agent">
        <rect x="62" y="218" width="80" height="60" rx="4" />
        <text x="102" y="244" textAnchor="middle" className="k8s-pod__name">stella-agent</text>
        <text x="102" y="262" textAnchor="middle" className="k8s-pod__status">● running</text>
      </g>

      <g className="k8s-pod k8s-pod--agent">
        <rect x="156" y="218" width="80" height="60" rx="4" />
        <text x="196" y="244" textAnchor="middle" className="k8s-pod__name">stella-agent</text>
        <text x="196" y="262" textAnchor="middle" className="k8s-pod__status">● running</text>
      </g>

      <g className="k8s-pod k8s-pod--agent">
        <rect x="250" y="218" width="80" height="60" rx="4" />
        <text x="290" y="244" textAnchor="middle" className="k8s-pod__name">stella-light</text>
        <text x="290" y="262" textAnchor="middle" className="k8s-pod__status">● running</text>
      </g>

      <g className="k8s-pod k8s-pod--agent k8s-pod--pending">
        <rect x="344" y="218" width="44" height="60" rx="4" strokeDasharray="4 2" />
        <text x="366" y="254" textAnchor="middle" className="k8s-pod__plus">+</text>
      </g>
    </svg>
  );
}

// Hero Section
function HeroSection() {
  return (
    <header className="hero">
      <div className="hero__container">
        <div className="hero__badge">Open Source Voice AI Platform</div>
        <h1 className="hero__title">
          Build conversational agents
          <span className="hero__title-accent"> that speak</span>
        </h1>
        <p className="hero__subtitle">
          STELLA is a complete platform for building, deploying, and managing
          voice-enabled AI agents with real-time WebRTC communication and
          Kubernetes orchestration.
        </p>
        <div className="hero__actions">
          <Link className="hero__button hero__button--primary" to="/docs/guides/getting-started">
            Get Started
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link className="hero__button hero__button--secondary" to="https://github.com/c4dhi/STELLA_backend">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            View on GitHub
          </Link>
        </div>
        <HeroTerminal />
      </div>
    </header>
  );
}

// Terminal in Hero
function HeroTerminal() {
  const [copied, setCopied] = useState(false);

  const commands = [
    'git clone https://github.com/c4dhi/STELLA_backend.git',
    'cd STELLA_backend',
    'cp .env.example .env',
    './scripts/start-k8s.sh',
  ];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commands.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="hero__terminal">
      <div className="hero__terminal-header">
        <span className="hero__terminal-dot hero__terminal-dot--red"></span>
        <span className="hero__terminal-dot hero__terminal-dot--yellow"></span>
        <span className="hero__terminal-dot hero__terminal-dot--green"></span>
        <button
          className={`hero__terminal-copy ${copied ? 'hero__terminal-copy--copied' : ''}`}
          onClick={handleCopy}
          aria-label="Copy commands"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
      <div className="hero__terminal-content">
        <code>
          {commands.map((cmd, idx) => (
            <div key={idx}>
              <span className="hero__terminal-prompt">$</span>
              <span> {cmd}</span>
            </div>
          ))}
        </code>
      </div>
    </div>
  );
}

// Why STELLA Section
function WhyStellaSection() {
  const features = [
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
      description: 'WebRTC-powered communication via LiveKit with low-latency streaming, echo cancellation, and noise suppression.',
      link: '/docs/integration/livekit',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      ),
      title: 'Modular Agents',
      description: 'Build custom agents with pluggable STT, LLM, and TTS providers using our Python SDK.',
      link: '/docs/guides/create-your-own-agent',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
      ),
      title: 'Tool Calling',
      description: 'Agents autonomously execute functions based on conversation context—search databases, call APIs, or trigger workflows.',
      link: '/docs/sdk/tools',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      title: 'Session Lifecycle',
      description: 'Full state management with pause/resume, graceful shutdown, and automatic resource cleanup.',
      link: '/docs/architecture/session-lifecycle',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
      title: 'Persistent Transcripts',
      description: 'Every conversation is stored in PostgreSQL with full speaker attribution and message history.',
      link: '/docs/architecture/data-flow',
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
      title: 'Kubernetes Native',
      description: 'Each session runs in an isolated pod with automatic scaling, resource limits, and monitoring.',
      link: '/docs/architecture/kubernetes-orchestration',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      ),
      title: 'Progress Tracking',
      description: 'Real-time task status with todo lists, percentage indicators, and visual agent state feedback.',
      link: '/docs/sdk/message-types',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 11a9 9 0 0 1 9 9"/>
          <path d="M4 4a16 16 0 0 1 16 16"/>
          <circle cx="5" cy="19" r="1"/>
        </svg>
      ),
      title: 'Streaming Pipeline',
      description: 'Streaming STT and TTS for minimal latency—audio playback begins before the full response is generated.',
      link: '/docs/sdk/streaming',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      ),
      title: 'Multi-Modal Input',
      description: 'Accept both voice and text input with intelligent VAD for natural conversation flow and interruption handling.',
      link: '/docs/sdk/base-agent',
    },
  ];

  return (
    <section className="features">
      <div className="features__container">
        <div className="features__header">
          <h2 className="features__title">Why STELLA?</h2>
          <p className="features__subtitle">
            Everything you need to build voice-enabled AI experiences
          </p>
        </div>
        <div className="features__grid">
          {features.map((feature, idx) => (
            <Link key={idx} to={feature.link} className="feature-card">
              <div className="feature-card__icon">{feature.icon}</div>
              <h3 className="feature-card__title">{feature.title}</h3>
              <p className="feature-card__description">{feature.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// Architecture Section
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
          <Link className="architecture__link" to="/docs/architecture/overview">
            View architecture docs
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </div>
        <div className="architecture__diagram">
          <KubernetesArchitectureDiagram />
        </div>
      </div>
    </section>
  );
}

// Quick Start Section (Supabase-style)
function QuickStartSection() {
  return (
    <section className="quickstart">
      <div className="quickstart__container">
        <div className="quickstart__header">
          <h2 className="quickstart__title">Start in minutes</h2>
        </div>
        <div className="quickstart__steps">
          <div className="quickstart__step">
            <div className="quickstart__step-number">1</div>
            <div className="quickstart__step-content">
              <h3>Clone & Configure</h3>
              <p>Get the source and set up your API keys</p>
              <div className="quickstart__code">
                <code>git clone https://github.com/c4dhi/STELLA_backend.git && cd STELLA_backend && cp .env.example .env</code>
              </div>
            </div>
          </div>
          <div className="quickstart__step">
            <div className="quickstart__step-number">2</div>
            <div className="quickstart__step-content">
              <h3>Add Credentials</h3>
              <p>Add your OpenAI and LiveKit API keys</p>
              <div className="quickstart__code">
                <code>OPENAI_API_KEY=sk-...<br/>LIVEKIT_API_KEY=...</code>
              </div>
            </div>
          </div>
          <div className="quickstart__step">
            <div className="quickstart__step-number">3</div>
            <div className="quickstart__step-content">
              <h3>Deploy</h3>
              <p>Start the entire stack with one command</p>
              <div className="quickstart__code">
                <code>./scripts/start-k8s.sh</code>
              </div>
            </div>
          </div>
        </div>
        <div className="quickstart__actions">
          <Link className="quickstart__button" to="/docs/guides/getting-started">
            Read the full guide
          </Link>
        </div>
      </div>
    </section>
  );
}

// Agents Deep Dive Section
function AgentsDeepDiveSection() {
  return (
    <section className="agents-deep-dive">
      <div className="agents-deep-dive__container">
        <div className="agents-deep-dive__header">
          <h2 className="agents-deep-dive__title">Two Agents, Different Tradeoffs</h2>
          <p className="agents-deep-dive__subtitle">
            Choose the right agent architecture for your use case
          </p>
        </div>

        <div className="agents-deep-dive__comparison">
          {/* stella-agent */}
          <div className="agent-detail">
            <div className="agent-detail__header">
              <h3 className="agent-detail__name">stella-agent</h3>
              <span className="agent-detail__badge">Full Featured</span>
            </div>

            <p className="agent-detail__description">
              A 3-stage pipeline with intelligent routing, expert consultation, and response synthesis.
              Built for complex multi-turn conversations requiring deep reasoning.
            </p>

            <div className="agent-detail__pipeline">
              <div className="agent-detail__pipeline-title">Processing Pipeline</div>
              <StellaAgentDiagram />
            </div>

            <div className="agent-detail__features">
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>3-stage routing with SAFE/UNSAFE classification</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Parallel expert pool for complex queries</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Full tool calling via gRPC state machine</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>STRICT/LOOSE task execution modes</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Timekeeper for stuck conversation recovery</span>
              </div>
            </div>

            <div className="agent-detail__specs">
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Model</span>
                <span className="agent-detail__spec-value">GPT-4o</span>
              </div>
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Latency</span>
                <span className="agent-detail__spec-value">2-3s</span>
              </div>
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Memory</span>
                <span className="agent-detail__spec-value">512Mi-2Gi</span>
              </div>
            </div>

            <Link to="/docs/agents/stella-agent" className="agent-detail__link">
              View full documentation
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>

          {/* stella-light */}
          <div className="agent-detail">
            <div className="agent-detail__header">
              <h3 className="agent-detail__name">stella-light</h3>
              <span className="agent-detail__badge agent-detail__badge--light">Lightweight</span>
            </div>

            <p className="agent-detail__description">
              A streamlined single-call architecture optimized for speed. Two-phase execution ensures
              immediate voice response while state updates happen in the background.
            </p>

            <div className="agent-detail__pipeline">
              <div className="agent-detail__pipeline-title">Processing Pipeline</div>
              <StellaLightDiagram />
            </div>

            <div className="agent-detail__features">
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Single LLM call for minimal latency</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Two-phase: voice first, tools in background</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Same tool calling via gRPC state machine</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Streaming response parsing on-the-fly</span>
              </div>
              <div className="agent-detail__feature">
                <span className="agent-detail__feature-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span>Lower resource footprint</span>
              </div>
            </div>

            <div className="agent-detail__specs">
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Model</span>
                <span className="agent-detail__spec-value">GPT-4o-mini</span>
              </div>
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Latency</span>
                <span className="agent-detail__spec-value">1-2s</span>
              </div>
              <div className="agent-detail__spec">
                <span className="agent-detail__spec-label">Memory</span>
                <span className="agent-detail__spec-value">256Mi-1Gi</span>
              </div>
            </div>

            <Link to="/docs/agents/stella-light-agent" className="agent-detail__link">
              View full documentation
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7H13M13 7L7 1M13 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Shared Pipeline */}
        <div className="agents-deep-dive__shared">
          <h3 className="agents-deep-dive__shared-title">Shared Audio Pipeline</h3>
          <p className="agents-deep-dive__shared-description">
            Both agents use the same SDK-powered audio pipeline with configurable providers
          </p>
          <div className="agents-deep-dive__pipeline-flow">
            <div className="pipeline-step">
              <div className="pipeline-step__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                </svg>
              </div>
              <div className="pipeline-step__label">Voice Input</div>
              <div className="pipeline-step__detail">WebRTC via LiveKit</div>
            </div>
            <div className="pipeline-arrow">→</div>
            <div className="pipeline-step">
              <div className="pipeline-step__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div className="pipeline-step__label">STT</div>
              <div className="pipeline-step__detail">Sherpa / Whisper</div>
            </div>
            <div className="pipeline-arrow">→</div>
            <div className="pipeline-step">
              <div className="pipeline-step__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div className="pipeline-step__label">LLM</div>
              <div className="pipeline-step__detail">OpenAI / Ollama</div>
            </div>
            <div className="pipeline-arrow">→</div>
            <div className="pipeline-step">
              <div className="pipeline-step__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              </div>
              <div className="pipeline-step__label">TTS</div>
              <div className="pipeline-step__detail">Kokoro / ElevenLabs</div>
            </div>
            <div className="pipeline-arrow">→</div>
            <div className="pipeline-step">
              <div className="pipeline-step__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                </svg>
              </div>
              <div className="pipeline-step__label">User</div>
              <div className="pipeline-step__detail">Audio Response</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// CTA Banner
function CTABanner() {
  return (
    <section className="cta-banner">
      <div className="cta-banner__container">
        <h2 className="cta-banner__title">Ready to build your voice AI agent?</h2>
        <p className="cta-banner__subtitle">
          Get started with the documentation or jump into the code on GitHub.
        </p>
        <div className="cta-banner__actions">
          <Link className="hero__button hero__button--primary" to="/docs/guides/getting-started">
            Read the Docs
          </Link>
          <Link className="hero__button hero__button--secondary" to="/docs/guides/create-your-own-agent">
            Build Your Agent
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): React.ReactElement {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="STELLA Documentation"
      description="Build conversational AI agents that speak. STELLA is an open-source platform for voice-enabled AI with real-time WebRTC communication.">
      <main className="home">
        <HeroSection />
        <WhyStellaSection />
        <ArchitectureSection />
        <QuickStartSection />
        <AgentsDeepDiveSection />
        <CTABanner />
      </main>
    </Layout>
  );
}
