import { formatCompactCurrency } from "../utils/dataHelpers.js";

function RankRow({ rest, rank, barPct, valueNode, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`ranking-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(String(rest.id))}
    >
      {rank != null && <span className="ranking-rank">{rank}</span>}
      <span className="ranking-name">
        Restaurant {rest.id}
        <span className="ranking-province">{rest.province}</span>
      </span>
      <span className="ranking-bar-track">
        <span
          className={`ranking-bar-fill ${barPct.cls}`}
          style={{ width: `${barPct.width}%` }}
        />
      </span>
      <span className="ranking-value">{valueNode}</span>
    </button>
  );
}

export default function RestaurantRanking({
  ranking,
  selectedRestaurant,
  onSelectRestaurant,
  showForecast,
}) {
  if (!ranking) return null;

  // ── Forecast mode: top gainers / decliners by % change ──
  if (showForecast && ranking.mode === "forecast") {
    const gainers = ranking.gainers.slice(0, 5);
    const decliners = ranking.decliners.slice(0, 5);
    const { maxAbsPct } = ranking;

    const renderGroup = (rows, cls, heading, glyph) => (
      <div className="ranking-group">
        <div className={`ranking-group-heading ${cls}`}>
          <span className="ranking-group-glyph">{glyph}</span>
          {heading}
        </div>
        {rows.length === 0 ? (
          <div className="ranking-empty">No restaurants in this group.</div>
        ) : (
          rows.map((m) => (
            <RankRow
              key={m.id}
              rest={m}
              barPct={{
                width: (Math.abs(m.pct) / maxAbsPct) * 100,
                cls,
              }}
              selected={String(m.id) === selectedRestaurant}
              onSelect={onSelectRestaurant}
              valueNode={
                <>
                  <span className={`ranking-pct ${cls}`}>
                    {m.pct >= 0 ? "+" : "−"}
                    {Math.abs(m.pct).toFixed(0)}%
                  </span>
                  <span className="ranking-delta">
                    {m.delta >= 0 ? "+" : "−"}
                    {formatCompactCurrency(Math.abs(m.delta))}
                  </span>
                </>
              }
            />
          ))
        )}
      </div>
    );

    return (
      <section className="ranking-section">
        <div className="ranking-header">
          <h2 className="ranking-heading">Biggest Forecast Movers</h2>
          <span className="ranking-subtitle">
            July forecast vs June actuals
          </span>
        </div>
        <div className="ranking-columns">
          {renderGroup(gainers, "good", "Top Gainers", "▲")}
          {renderGroup(decliners, "bad", "Top Decliners", "▼")}
        </div>
      </section>
    );
  }

  // ── Revenue mode: all restaurants by total revenue ──
  const { rows: allRows, max, rangeLabel } = ranking;
  const rows = allRows.slice(0, 12);

  return (
    <section className="ranking-section">
      <div className="ranking-header">
        <h2 className="ranking-heading">Restaurant Ranking</h2>
        <span className="ranking-subtitle">Top 15 · Total revenue · {rangeLabel}</span>
      </div>
      <div className="ranking-grid">
        {rows.map((r, i) => (
          <RankRow
            key={r.id}
            rest={r}
            rank={i + 1}
            barPct={{
              width: max > 0 ? (r.value / max) * 100 : 0,
              cls: "accent",
            }}
            selected={String(r.id) === selectedRestaurant}
            onSelect={onSelectRestaurant}
            valueNode={
              <span className="ranking-pct">
                {formatCompactCurrency(r.value)}
              </span>
            }
          />
        ))}
      </div>
    </section>
  );
}
