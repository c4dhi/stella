import { ArrowRight, Github, Star } from 'lucide-react';
import Link from '@docusaurus/Link';
import { Button } from '../ui/button';
import { AnimatedSection } from './AnimatedSection';

const Hero = () => {
  return (
    <section className="hero-section">
      {/* Background with gradient glows */}
      <div className="hero-background" />

      <div className="hero-content">
        <div className="hero-inner">
          {/* Open Source Badge */}
          <AnimatedSection animation="fade-up">
            <div className="hero-badge">
              <Star className="hero-badge-icon" />
              <span>Open Source</span>
            </div>
          </AnimatedSection>

          {/* Headline */}
          <AnimatedSection animation="fade-up" delay={100}>
            <h1 className="hero-title">
              Focus on your agent.{' '}
              <span className="hero-title-gradient">We handle the rest.</span>
            </h1>
          </AnimatedSection>

          {/* Subtitle */}
          <AnimatedSection animation="fade-up" delay={200}>
            <p className="hero-subtitle">
              STELLA manages the audio pipeline, voice streaming, and session orchestration.
              Build your agent logic, deploy instantly, and share a link—users start talking immediately.
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
                  <span>stella.ai/demo</span>
                </div>
              </div>
              {/* Content Area */}
              <div className="hero-browser-content">
                <div className="hero-waveform-container">
                  {/* Voice Waveform Animation */}
                  <div className="hero-waveform">
                    {[...Array(20)].map((_, i) => (
                      <div
                        key={i}
                        className="hero-waveform-bar"
                        style={{
                          height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 20}px`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                  </div>
                  <p className="hero-waveform-label">Voice AI Demo</p>
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
