import React, { useEffect, useState, useRef } from 'react';
import styles from './Affiliations.module.css';
import { AnimatedSection } from './AnimatedSection';

// Import university logos
import hsgLogo from '@site/assets/universities/HSG_Logo_DE_RGB.svg.png';
import uzhLogo from '@site/assets/universities/uzh-logo-white.png';
import ethLogo from '@site/assets/universities/ETH_Zürich_Logo_white.png';
import tumLogo from '@site/assets/universities/tum-logo-white.webp';
import yaleLogo from '@site/assets/universities/yale-white@2x.png';

const affiliations = [
  {
    name: 'University of St. Gallen',
    abbr: 'HSG',
    logo: hsgLogo,
    invert: true,
    url: 'https://www.unisg.ch',
    height: 38, // Visual balance adjustment
  },
  {
    name: 'University of Zurich',
    abbr: 'UZH',
    logo: uzhLogo,
    invert: false,
    url: 'https://www.uzh.ch',
    height: 50,
  },
  {
    name: 'ETH Zurich',
    abbr: 'ETH',
    logo: ethLogo,
    invert: false,
    url: 'https://ethz.ch',
    height: 32,
  },
  {
    name: 'TU Munich',
    abbr: 'TUM',
    logo: tumLogo,
    invert: false,
    url: 'https://www.tum.de',
    height: 39,
  },
  {
    name: 'Yale University',
    abbr: 'Yale',
    logo: yaleLogo,
    invert: false,
    url: 'https://www.yale.edu',
    height: 72,
  },
];

const Affiliations = () => {
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Double the items for infinite scroll effect
  const scrollItems = isMobile ? [...affiliations, ...affiliations] : affiliations;

  const renderLogo = (affiliation: typeof affiliations[0], index?: number) => (
    <a
      key={index !== undefined ? `${affiliation.abbr}-${index}` : affiliation.abbr}
      href={affiliation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.logoLink}
      title={affiliation.name}
    >
      <img
        src={affiliation.logo}
        alt={affiliation.name}
        className={`${styles.logo} ${affiliation.invert ? styles.logoInvert : ''}`}
        style={{ height: `${affiliation.height}px` }}
      />
    </a>
  );

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <AnimatedSection animation="fade">
          <p className={styles.label}>Developed by researchers from</p>
        </AnimatedSection>

        {isMobile ? (
          <AnimatedSection animation="fade-up" delay={100}>
            <div className={styles.carouselWrapper}>
              <div className={styles.carousel} ref={scrollRef}>
                {scrollItems.map((affiliation, index) => renderLogo(affiliation, index))}
              </div>
            </div>
          </AnimatedSection>
        ) : (
          <div className={styles.logoGrid}>
            {affiliations.map((affiliation, index) => (
              <AnimatedSection
                key={affiliation.abbr}
                animation="fade-up"
                delay={100 + index * 100}
              >
                {renderLogo(affiliation)}
              </AnimatedSection>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default Affiliations;
