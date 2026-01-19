import { ArrowRight, Github, Star } from 'lucide-react';
import Link from '@docusaurus/Link';
import { Button } from '../ui/button';

const Hero = () => {
  return (
    <section className="hero-section">
      {/* Background with gradient glows */}
      <div className="hero-background" />

      <div className="hero-content">
        <div className="hero-inner">
          {/* Open Source Badge */}
          <div className="hero-badge">
            <Star className="hero-badge-icon" />
            <span>Open Source</span>
          </div>

          {/* Headline */}
          <h1 className="hero-title">
            Build conversational agents{' '}
            <span className="hero-title-gradient">that speak</span>
          </h1>

          {/* Subtitle */}
          <p className="hero-subtitle">
            STELLA handles the entire voice AI stack—build your agent, deploy it, and share a link.
            Users can start talking to your agent instantly, with full session orchestration handled automatically.
          </p>

          {/* CTA Buttons */}
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

          {/* Browser Mockup */}
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
        </div>
      </div>
    </section>
  );
};

export default Hero;
