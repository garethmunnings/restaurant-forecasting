import { formatCompactCurrency } from "../utils/dataHelpers.js";

export default function RevenueTotal({ kpis, summary }) {
  if (!kpis) return null;

  return (
    <div className="revenue-total">
      <div className="revenue-total-label">{kpis.totalLabel}</div>
      <div className="revenue-total-value">
        {formatCompactCurrency(kpis.total)}
      </div>
      {summary && (
        <p className={`revenue-summary ${summary.sentiment}`}>
          {summary.text}
        </p>
      )}
    </div>
  );
}
