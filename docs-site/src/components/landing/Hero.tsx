import { ArrowRight, Github, Mic } from 'lucide-react';
import Link from '@docusaurus/Link';
import { Button } from '../ui/button';
import { AnimatedSection } from './AnimatedSection';
import HeroSphereDemo from './HeroSphereDemo';

const Hero = () => {
  return (
    <section className="hero-section">
      {/* Background with gradient glows */}
      <div className="hero-background" />

      <div className="hero-content">
        <div className="hero-inner">
          {/* Tagline */}
          <AnimatedSection animation="fade-up">
            <p className="hero-tagline">Open Source Conversational AI Infrastructure</p>
          </AnimatedSection>

          {/* Headline */}
          <AnimatedSection animation="fade-up" delay={100}>
            <h1 className="hero-title">
              Focus on your agent.
              <br />
              <span className="hero-title-gradient">We handle the rest.</span>
            </h1>
          </AnimatedSection>

          {/* Subtitle */}
          <AnimatedSection animation="fade-up" delay={150}>
            <p className="hero-subtitle">
              STELLA handles audio, voice and video streaming, as well as orchestration so you can build and deploy voice agents instantly.
            </p>
          </AnimatedSection>

          {/* CTA Buttons */}
          <AnimatedSection animation="fade-up" delay={300}>
            <div className="hero-buttons">
              <Button asChild size="lg" className="hero-btn-primary">
                <Link to="/docs/guides/getting-started">
                  Get Started
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="hero-btn-secondary"
              >
                <Link to="https://github.com/c4dhi/STELLA_backend">
                  <Github className="mr-2 w-5 h-5" />
                  GitHub
                </Link>
              </Button>
            </div>
          </AnimatedSection>

          {/* Browser Mockup */}
          <AnimatedSection animation="fade-up" delay={400}>
            <div className="hero-browser">
              <div className="hero-browser-window">
                {/* Browser Header */}
                <div className="hero-browser-header">
                  <div className="hero-browser-dots">
                    <div className="hero-browser-dot hero-browser-dot--red" />
                    <div className="hero-browser-dot hero-browser-dot--yellow" />
                    <div className="hero-browser-dot hero-browser-dot--green" />
                  </div>
                  <div className="hero-browser-url">
                    <span>STELLA Demo</span>
                  </div>
                </div>
                {/* Content Area */}
                <div className="hero-browser-content">
                  <div className="hero-sphere-container">
                    <HeroSphereDemo />
                  </div>
                </div>
                {/* Hover Overlay */}
                <div className="hero-browser-overlay">
                  <div className="hero-browser-overlay-border" />
                  <div className="hero-browser-overlay-content">
                    <div className="hero-browser-overlay-icon">
                      <Mic />
                    </div>
                    <h3 className="hero-browser-overlay-title">Try the Demo</h3>
                    <p className="hero-browser-overlay-text">
                      Experience STELLA's voice AI capabilities firsthand.
                    </p>
                    <button className="hero-browser-overlay-btn" disabled>
                      Currently Unavailable
                    </button>
                    <p className="hero-browser-overlay-disclaimer">
                      Clicking will redirect you to an external demo session.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
};

export default Hero;
