import { ArrowRight, Sparkles } from 'lucide-react';
import Link from '@docusaurus/Link';
import { Button } from '../ui/button';
import { AnimatedSection } from './AnimatedSection';

const CTABanner = () => {
  return (
    <section className="cta-section">
      {/* Background with gradient */}
      <div className="cta-background" />

      <div className="cta-content">
        <AnimatedSection animation="scale">
          <div className="cta-inner">
            {/* Badge */}
            <div className="cta-badge">
              <Sparkles className="cta-badge-icon" />
              <span>Ready to get started?</span>
            </div>

            {/* Headline */}
            <h2 className="cta-title">
              Let users talk to
              <br />
              <span className="cta-title-gradient">your AI agent</span>
            </h2>

            {/* Subtitle */}
            <p className="cta-subtitle">
              Build your agent, deploy it, and share a link.
              <span className="cta-subtitle-bold"> It's that simple.</span>
            </p>

            {/* CTA Buttons */}
            <div className="cta-buttons">
              <Button asChild size="lg" className="cta-btn-primary">
                <Link to="/docs/guides/getting-started">
                  Start Building
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="cta-btn-secondary">
                <Link to="/docs/guides/getting-started">
                  Read Documentation
                </Link>
              </Button>
            </div>

            {/* Trust indicator */}
            <p className="cta-footer">
              Open source · MIT License · Community driven
            </p>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
};

export default CTABanner;
