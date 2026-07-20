import React, { useEffect, useState, useRef } from 'react';
import styles from './Affiliations.module.css';
import { AnimatedSection } from './AnimatedSection';

const affiliations = [
  {
    name: 'University of St. Gallen',
    abbr: 'HSG',
    url: 'https://www.unisg.ch',
  },
  {
    name: 'University of Zurich',
    abbr: 'UZH',
    url: 'https://www.uzh.ch',
  },
  {
    name: 'ETH Zurich',
    abbr: 'ETH',
    url: 'https://ethz.ch',
  },
  {
    name: 'TU Munich',
    abbr: 'TUM',
    url: 'https://www.tum.de',
  },
  {
    name: 'Yale University',
    abbr: 'Yale',
    url: 'https://www.yale.edu',
  },
];

const Affiliations = () => {
  // Switch to the infinite carousel whenever the names don't fit on one row.
  const [useCarousel, setUseCarousel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      // The hidden measurer lays out every name in a single non-wrapping row at
      // its natural size; if that's wider than the container, we can't fit them.
      setUseCarousel(measure.scrollWidth > container.clientWidth);
    };

    check();
    const ro = new ResizeObserver(check);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);

  // Duplicate the items so the -50% scroll loop is seamless.
  const scrollItems = [...affiliations, ...affiliations];

  const renderName = (affiliation: typeof affiliations[0], index?: number) => (
    <a
      key={index !== undefined ? `${affiliation.abbr}-${index}` : affiliation.abbr}
      href={affiliation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.logoLink}
      title={affiliation.name}
    >
      <span className={styles.name}>{affiliation.name}</span>
    </a>
  );

  const separator = (key: string) => (
    <span key={key} className={styles.separator} aria-hidden="true">
      –
    </span>
  );

  return (
    <section className={styles.section}>
      <div className={styles.container} ref={containerRef}>
        <AnimatedSection animation="fade">
          <p className={styles.label}>Developed by researchers from</p>
        </AnimatedSection>

        {/* Hidden measurer: natural single-row width of all names + separators */}
        <div className={styles.measure} ref={measureRef} aria-hidden="true">
          {affiliations.map((affiliation, index) => (
            <React.Fragment key={affiliation.abbr}>
              <span className={styles.logoLink}>
                <span className={styles.name}>{affiliation.name}</span>
              </span>
              {index < affiliations.length - 1 && separator(`m-sep-${index}`)}
            </React.Fragment>
          ))}
        </div>

        {useCarousel ? (
          <AnimatedSection animation="fade-up" delay={100}>
            <div className={styles.carouselWrapper}>
              <div className={styles.carousel}>
                {/* Trailing separator after every item so the loop seam reads "… | A | …" */}
                {scrollItems.map((affiliation, index) => (
                  <React.Fragment key={`${affiliation.abbr}-${index}`}>
                    {renderName(affiliation, index)}
                    {separator(`c-sep-${index}`)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </AnimatedSection>
        ) : (
          <div className={styles.logoGrid}>
            {affiliations.map((affiliation, index) => (
              <React.Fragment key={affiliation.abbr}>
                <AnimatedSection animation="fade-up" delay={100 + index * 100}>
                  {renderName(affiliation)}
                </AnimatedSection>
                {index < affiliations.length - 1 && separator(`g-sep-${index}`)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default Affiliations;
