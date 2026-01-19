import { Zap, Feather, Mic, Brain, Volume2 } from 'lucide-react';
import Link from '@docusaurus/Link';

const AgentTypes = () => {
  return (
    <section id="agents" className="section-dark section-alt">
      <div className="section-container">
        <div className="section-header">
          <h2 className="section-title">Choose Your Agent</h2>
          <p className="section-subtitle">
            Two agent architectures optimized for different use cases
          </p>
        </div>

        <div className="agents-grid">
          {/* stella-agent */}
          <Link to="/docs/agents/stella-agent" className="agent-card">
            <div className="agent-card-badge agent-card-badge--primary">Full Featured</div>
            <div className="agent-card-header">
              <div className="agent-card-icon agent-card-icon--primary">
                <Zap className="w-7 h-7" />
              </div>
              <h3 className="agent-card-title">stella-agent</h3>
              <p className="agent-card-desc">
                3-stage pipeline with intelligent routing for complex multi-turn conversations
              </p>
            </div>
            <div className="agent-card-specs">
              <div className="agent-card-spec">
                <span>Model</span>
                <span>GPT-4o</span>
              </div>
              <div className="agent-card-spec">
                <span>Latency</span>
                <span>2-3s</span>
              </div>
              <div className="agent-card-spec agent-card-spec--last">
                <span>Memory</span>
                <span>512Mi - 2Gi</span>
              </div>
            </div>
          </Link>

          {/* stella-light */}
          <Link to="/docs/agents/stella-light-agent" className="agent-card">
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
            <div className="agent-card-specs">
              <div className="agent-card-spec">
                <span>Model</span>
                <span>GPT-4o-mini</span>
              </div>
              <div className="agent-card-spec">
                <span>Latency</span>
                <span>1-2s</span>
              </div>
              <div className="agent-card-spec agent-card-spec--last">
                <span>Memory</span>
                <span>256Mi - 1Gi</span>
              </div>
            </div>
          </Link>
        </div>

        {/* Audio Pipeline */}
        <div className="pipeline-section">
          <h3 className="pipeline-title">Shared Audio Pipeline</h3>
          <div className="pipeline-flow">
            {[
              { icon: Mic, label: 'Voice Input' },
              { label: 'STT', isText: true },
              { icon: Brain, label: 'Agent Processing' },
              { label: 'TTS', isText: true },
              { icon: Volume2, label: 'User' },
            ].map((item, index, arr) => (
              <div key={item.label} className="pipeline-item">
                <div className="pipeline-item-inner">
                  <div className="pipeline-item-box">
                    {item.isText ? (
                      <span className="pipeline-item-text">{item.label}</span>
                    ) : (
                      <item.icon className="w-6 h-6 md:w-8 md:h-8" />
                    )}
                  </div>
                  {!item.isText && <span className="pipeline-item-label">{item.label}</span>}
                </div>
                {index < arr.length - 1 && <div className="pipeline-connector" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AgentTypes;
