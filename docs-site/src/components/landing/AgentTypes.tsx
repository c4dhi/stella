import { Zap, Feather, Wrench, Check, X, ArrowRight } from 'lucide-react';
import Link from '@docusaurus/Link';
import { AnimatedSection } from './AnimatedSection';

const AgentTypes = () => {
  return (
    <section id="agents" className="section-dark section-alt">
      <div className="section-container">
        <AnimatedSection animation="fade-up">
          <div className="section-header">
            <h2 className="section-title">Choose Your Agent</h2>
            <p className="section-subtitle">
              Use pre-built agents or create your own with the Agent SDK
            </p>
          </div>
        </AnimatedSection>

        <div className="agents-grid agents-grid--three">
          {/* stella-agent */}
          <AnimatedSection animation="fade-up" delay={100}>
            <Link to="/docs/agents/stella-agent" className="agent-card">
              <div className="agent-card-badge agent-card-badge--primary">Full Featured</div>
              <div className="agent-card-header">
                <div className="agent-card-icon agent-card-icon--primary">
                  <Zap className="w-7 h-7" />
                </div>
                <h3 className="agent-card-title">stella-agent</h3>
                <p className="agent-card-desc">
                  Multi-stage pipeline with intelligent routing for complex, agent-supported multi-turn conversations
                </p>
              </div>
              <div className="agent-card-features">
                <div className="agent-card-feature">
                  <span>Tool Calling</span>
                  <Check className="agent-card-feature-check" />
                </div>
                <div className="agent-card-feature">
                  <span>Plans</span>
                  <Check className="agent-card-feature-check" />
                </div>
                <div className="agent-card-feature">
                  <span>Experts</span>
                  <Check className="agent-card-feature-check" />
                </div>
                <div className="agent-card-feature">
                  <span>Latency</span>
                  <span className="agent-card-feature-value">2-3s</span>
                </div>
              </div>
              <div className="agent-card-link agent-card-link--primary">
                Read the docs
                <ArrowRight className="w-4 h-4" />
              </div>
            </Link>
          </AnimatedSection>

          {/* stella-light */}
          <AnimatedSection animation="fade-up" delay={200}>
            <Link to="/docs/agents/stella-light-agent" className="agent-card agent-card--green">
              <div className="agent-card-badge agent-card-badge--green">Lightweight</div>
              <div className="agent-card-header">
                <div className="agent-card-icon agent-card-icon--green">
                  <Feather className="w-7 h-7" />
                </div>
                <h3 className="agent-card-title">stella-light</h3>
                <p className="agent-card-desc">
                  Single LLM call architecture optimized for quick responses
                </p>
              </div>
              <div className="agent-card-features">
                <div className="agent-card-feature">
                  <span>Tool Calling</span>
                  <Check className="agent-card-feature-check" />
                </div>
                <div className="agent-card-feature">
                  <span>Plans</span>
                  <Check className="agent-card-feature-check" />
                </div>
                <div className="agent-card-feature">
                  <span>Experts</span>
                  <X className="agent-card-feature-x" />
                </div>
                <div className="agent-card-feature">
                  <span>Latency</span>
                  <span className="agent-card-feature-value">1-2s</span>
                </div>
              </div>
              <div className="agent-card-link agent-card-link--green">
                Read the docs
                <ArrowRight className="w-4 h-4" />
              </div>
            </Link>
          </AnimatedSection>

          {/* Build Your Own */}
          <AnimatedSection animation="fade-up" delay={300}>
            <Link to="/docs/guides/build-your-own-agent" className="agent-card agent-card--custom">
              <div className="agent-card-badge agent-card-badge--blue">Customizable</div>
              <div className="agent-card-header">
                <div className="agent-card-icon agent-card-icon--blue">
                  <Wrench className="w-7 h-7" />
                </div>
                <h3 className="agent-card-title">Build Your Own</h3>
                <p className="agent-card-desc">
                  Full control over processing logic. STELLA handles the audio pipeline—you focus on the conversation.
                </p>
              </div>
              <div className="agent-card-custom-content">
                <ul className="agent-card-custom-list">
                  <li>Build your own workflows and custom tools</li>
                  <li>Plugin any LLM provider</li>
                </ul>
                <div className="agent-card-custom-link">
                  Read the guide
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
};

export default AgentTypes;
