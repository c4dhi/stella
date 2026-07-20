import { Zap, Feather, Wrench, Check, X, ArrowRight } from 'lucide-react';
import Link from '@docusaurus/Link';
import { AnimatedSection } from './AnimatedSection';

const AgentTypes = () => {
  return (
    <section id="agents" className="section-dark section-alt">
      <div className="section-container">
        <AnimatedSection animation="fade-up">
          <div className="section-header">
            <div className="landing-eyebrow">
              Agents / <span className="landing-eyebrow-path">runtimes</span>
            </div>
            <h2 className="section-title">Choose Your Agent</h2>
            <p className="section-subtitle">
              Start with a ready-made conversation engine—or build your own
            </p>
          </div>
        </AnimatedSection>

        <div className="agents-grid agents-grid--three">
          {/* stella-agent */}
          <AnimatedSection animation="fade-up" delay={100}>
            <Link to="/docs/agents/stella-v2" className="agent-card">
              <div className="agent-card-badge agent-card-badge--primary">Full Featured</div>
              <div className="agent-card-header">
                <div className="agent-card-icon agent-card-icon--primary">
                  <Zap className="w-7 h-7" />
                </div>
                <h3 className="agent-card-title">stella-v2</h3>
                <p className="agent-card-desc">
                  Rich, guided conversations with multiple reasoning stages—built for high-stakes interviews and interventions where every response matters
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
                  <span>Backchannel</span>
                  <Check className="agent-card-feature-check" />
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
                  Fast, single-step responses—great for lightweight conversations and quick check-ins
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
                  <span>Backchannel</span>
                  <X className="agent-card-feature-x" />
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
                  Full control over the conversation logic. STELLA handles the voice pipeline—you focus on the conversation.
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
