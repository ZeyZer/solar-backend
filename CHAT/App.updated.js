
/*
  App.updated.js
  =================
  This file contains ONLY the new/updated code needed for the
  System Choices rework + daily energy usage graph.

  👉 Do NOT replace your whole App.js with this.
  👉 Copy the sections below into your existing App.js.
*/

/* =======================================================
   1. ADD THIS COMPONENT (near your other chart components)
======================================================= */

export function DailyUsageLineChart({ labels, values }) {
  if (!labels?.length || !values?.length) return null;

  const max = Math.max(...values);

  return (
    <div className="daily-usage-chart">
      <div className="chart-title">Typical daily energy usage</div>

      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        {values.map((v, i) => {
          if (i === 0) return null;

          const x1 = ((i - 1) / (values.length - 1)) * 100;
          const x2 = (i / (values.length - 1)) * 100;

          const y1 = 40 - (values[i - 1] / max) * 36;
          const y2 = 40 - (v / max) * 36;

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth="0.8"
            />
          );
        })}
      </svg>

      <div className="chart-footnote small-print">
        Relative energy use across a typical day
      </div>
    </div>
  );
}


/* =======================================================
   2. REPLACE YOUR EXISTING “SYSTEM CHOICES” SECTION
======================================================= */

/*
<section className="quote-section quote-section--clean">
  ...
</section>
*/

/*
USE THIS INSTEAD
*/

<section className="quote-section quote-section--clean">
  <div className="quote-section-head quote-section-head--clean">
    <div className="qsh-left">
      <h2 className="quote-h2 quote-h2--clean">System Choices</h2>
      <p className="quote-help">
        This is the system you have designed — edit choices to compare options.
      </p>
    </div>
  </div>

  {/* Row 1: Energy usage (plain) + chart */}
  <div className="system-row system-row--split">
    <div>
      <h4>Home’s energy usage</h4>
      <p><strong>Annual use:</strong> {quote.assumedAnnualConsumptionKWh?.toLocaleString()} kWh</p>
      <p><strong>Occupancy:</strong> {form.occupancyProfile}</p>
      <button className="link-btn" onClick={() => onEdit(2)}>Edit</button>
    </div>

    <DailyUsageLineChart
      labels={quote.dailyUsageProfile?.labels}
      values={quote.dailyUsageProfile?.fractions}
    />
  </div>

  {/* Row 2: Roof info in the “form section” style (thumb rows) */}
  <div className="choice-card choice-card--row">
    <div className="choice-card-head choice-card-head--titleline">
      <h4>Roof information</h4>
      <button type="button" className="link-btn" onClick={() => onEdit(3)}>Edit</button>
    </div>

    <div className="roof-info-topline">
      <div><strong>Roofs:</strong> {roofs.length}</div>
      <div><strong>Total panels:</strong> {totalPanels}</div>
    </div>

    {roofs?.length ? (
      <div className="roof-list">
        {roofs.map((r, idx) => {
          // Use the same “thumb row” visuals as the form (classes already exist)
          const thumbs = getRoofThumbsForRoof(r);

          return (
            <div key={r.id || idx} className="roof-list-item">
              <div className="roof-list-title">Roof {idx + 1}</div>

              <div className="thumbs-grid">
                <RoofSummaryRow
                  label="Orientation"
                  value={r.orientation || "—"}
                  thumbSrc={thumbs.orientation}
                />
                <RoofSummaryRow
                  label="Tilt"
                  value={r.tilt != null ? `${r.tilt}°` : "—"}
                  thumbSrc={thumbs.tilt}
                />
                <RoofSummaryRow
                  label="Shading"
                  value={r.shading || "—"}
                  thumbSrc={thumbs.shading}
                />
                <RoofSummaryRow
                  label="Panels"
                  value={r.panels ? String(r.panels) : "—"}
                  thumbSrc={thumbs.panels}
                />
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <p className="small-print">No roof data found — edit roofs to add them.</p>
    )}
  </div>

  {/* Row 3: System options (plain) */}
  <div className="system-row">
    <h4>System options</h4>
    <p><strong>Panel option:</strong> {form.panelOption}</p>
    <p><strong>Battery:</strong> {form.batteryKWh ? `${form.batteryKWh} kWh` : "None"}</p>
    <p><strong>EV charger:</strong> {form.evCharger ? "Yes" : "No"}</p>
    <p><strong>Bird protection:</strong> {form.birdProtection ? "Yes" : "No"}</p>
    <button className="link-btn" onClick={() => onEdit(4)}>Edit system</button>
  </div>
</section>
