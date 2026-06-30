import { formatCurrency } from "../utils/dataHelpers.js";

export default function KpiGroup({ kpis }) {
  if (!kpis) return null;

  const trendIcon =
    kpis.typicalDayTrend === "up" ? "\u25B2" : kpis.typicalDayTrend === "down" ? "\u25BC" : "\u2013";
  const trendClass = kpis.typicalDayTrend || "neutral";

  return (
    <div className="kpi-group">
      <div className="kpi-group-row">
        <div className="kpi-group-heading">Weekend vs Weekday</div>
        <div className="kpi-comparison">
          <div className="kpi-comparison-item">
            <span className="kpi-comparison-value">
              {formatCurrency(Math.round(kpis.weekendAvg))}
            </span>
            <span className="kpi-comparison-label">Weekend Avg</span>
          </div>
          <div className="kpi-comparison-divider" />
          <div className="kpi-comparison-item">
            <span className="kpi-comparison-value">
              {formatCurrency(Math.round(kpis.weekdayAvg))}
            </span>
            <span className="kpi-comparison-label">Weekday Avg</span>
          </div>
        </div>
      </div>

      <div className="kpi-group-row">
        <div className="kpi-group-heading">Daily Metrics</div>
        <div className="kpi-comparison">
          <div className="kpi-comparison-item">
            <span className="kpi-comparison-value">
              {formatCurrency(Math.round(kpis.typicalDay))}
              <span className={`trend-indicator ${trendClass}`}>
                {trendIcon}
              </span>
            </span>
            <span className="kpi-comparison-label">Typical Day</span>
          </div>
          <div className="kpi-comparison-divider" />
          <div className="kpi-comparison-item">
            <span className="kpi-comparison-value">
              {formatCurrency(Math.round(kpis.runRate))}
            </span>
            <span className="kpi-comparison-label">14-Day Run Rate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
