import { MessageSquare, HeartPulse, Compass } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

const useCases = [
  {
    icon: MessageSquare,
    tag: 'qualitative',
    title: 'Qualitative Research',
    description: 'Run consistent, scalable voice interviews. Every participant gets the same well-designed conversation, captured as full transcripts in their own words.',
  },
  {
    icon: HeartPulse,
    tag: 'intervention',
    title: 'Digital Interventions',
    description: 'Deliver motivational interviewing, coaching, and recurring check-ins that guide participants through behavior change—at any scale.',
  },
  {
    icon: Compass,
    tag: 'guided',
    title: 'Leading Conversations',
    description: 'Guide participants through screenings, structured surveys, and goal-directed dialogues where order and completeness matter.',
  },
];

const UseCases = () => {
  return (
    <section id="use-cases" className="features-section">
      <div className="features-container">
        <AnimatedSection animation="fade-up">
          <div className="features-header">
            <div className="landing-eyebrow">
              Use cases / <span className="landing-eyebrow-path">research</span>
            </div>
            <h2 className="features-title">
              For the whole spectrum of voice research
            </h2>
            <p className="features-subtitle">
              Whatever the conversation, STELLA runs it—on your terms
            </p>
          </div>
        </AnimatedSection>

        <div className="features-grid">
          {useCases.map((useCase) => (
            <div key={useCase.title} className="feature-card feature-card--static">
              <div className="feature-card-icon">
                <useCase.icon className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="feature-card-tag">[ {useCase.tag} ]</div>
              <h3 className="feature-card-title">{useCase.title}</h3>
              <p className="feature-card-description">
                {useCase.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCases;
