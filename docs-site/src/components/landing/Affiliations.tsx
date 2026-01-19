const affiliations = [
  { name: 'University of St. Gallen', abbr: 'HSG' },
  { name: 'University of Zurich', abbr: 'UZH' },
  { name: 'ETH Zurich', abbr: 'ETH' },
  { name: 'TUM', abbr: 'TUM' },
  { name: 'Yale', abbr: 'Yale' },
];

const Affiliations = () => {
  return (
    <section className="affiliations-section">
      <div className="affiliations-container">
        <p className="affiliations-label">Developed by researchers from</p>
        <div className="affiliations-list">
          {affiliations.map((affiliation) => (
            <div key={affiliation.abbr} className="affiliation-item">
              <div className="affiliation-icon">{affiliation.abbr.charAt(0)}</div>
              <span className="affiliation-name">{affiliation.name}</span>
              <span className="affiliation-abbr">{affiliation.abbr}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Affiliations;
