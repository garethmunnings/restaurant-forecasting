import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from "recharts";
import {
  formatCurrency,
  formatAxisValue,
  formatChartDate,
} from "../utils/dataHelpers.js";

function CustomTooltip({ active, payload, showHolidays }) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="custom-tooltip">
      <div className="tooltip-date">{data.dateLabel}</div>
      {data.actual != null && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "var(--accent)" }} />
          Actual: {formatCurrency(data.actual)}
        </div>
      )}
      {data.forecast != null && !data.isBridge && (
        <div className="tooltip-row">
          <span
            className="tooltip-dot"
            style={{ background: data.trendColor || "rgba(3, 23, 140, 0.6)" }}
          />
          Forecast: {formatCurrency(data.forecast)}
        </div>
      )}
      {showHolidays && data.schoolHoliday && (
        <div className="tooltip-row tooltip-row-note">
          <span className="tooltip-dot" style={{ background: "var(--holiday)" }} />
          {data.schoolHoliday}
        </div>
      )}
      {showHolidays && data.publicHoliday && (
        <div className="tooltip-row tooltip-row-note">
          <span className="tooltip-dot" style={{ background: "var(--holiday)" }} />
          {data.publicHoliday}
        </div>
      )}
    </div>
  );
}

const DATE_RANGES = [
  { key: "1m", label: "1M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

function LongRangeTick({ x, y, payload, data }) {
  const point = data[payload.index];
  if (!point) return null;
  const parts = point.date.split("-").map(Number);
  const month = parts[1] - 1; // 0-indexed
  const day = parts[2];
  // Only label near the 1st of the month to avoid duplicates in weekly data
  if (day > 7) return null;
  let label = "";
  if (month === 0) label = String(parts[0]); // year at January
  else if (month === 3) label = "Apr";
  else if (month === 6) label = "Jul";
  else if (month === 9) label = "Oct";
  if (!label) return null;
  return (
    <text x={x} y={y + 14} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
      {label}
    </text>
  );
}

// Collapse a predicate over the (chronologically ordered) data into contiguous
// [x1, x2] runs, keyed on the unique `date` field so they line up with the axis.
function buildSegments(data, predicate) {
  const segments = [];
  let start = null;
  for (let i = 0; i < data.length; i++) {
    const match = predicate(data[i]);
    if (match && start === null) {
      start = i;
    } else if (!match && start !== null) {
      segments.push({ x1: data[start].date, x2: data[i - 1].date });
      start = null;
    }
  }
  if (start !== null) {
    segments.push({ x1: data[start].date, x2: data[data.length - 1].date });
  }
  return segments;
}

export default function SalesChart({
  data,
  showForecast,
  showHolidays,
  onToggleHolidays,
  dateRange,
  onDateRangeChange,
}) {
  if (!data || data.length === 0) return null;

  // Determine tick interval based on data length
  const tickInterval =
    data.length > 365 ? 59
    : data.length > 180 ? 29
    : data.length > 60 ? 13
    : data.length > 30 ? 6
    : 3;

  // Find forecast boundary for reference line/area
  const forecastStartIdx = data.findIndex(
    (d) => d.date >= "2025-07-01" && !d.isBridge
  );
  const hasForecastData = showForecast && forecastStartIdx > -1;

  const useLineChart = dateRange === "1y" || dateRange === "all";

  // ─── Calendar overlays ──────────────────────────────────
  // School-holiday bands show on every range; weekend bands and public-holiday
  // markers are reserved for the zoomed-in daily views to avoid clutter.
  const schoolSegments = showHolidays
    ? buildSegments(data, (d) => d.schoolHoliday)
    : [];
  const weekendSegments =
    showHolidays && (dateRange === "1m" || dateRange === "6m")
      ? buildSegments(data, (d) => d.isWeekend && !d.isBridge)
      : [];

  const yAxisProps = {
    tickFormatter: formatAxisValue,
    tick: { fontSize: 11, fill: "var(--text-muted)" },
    tickLine: false,
    axisLine: false,
    width: 60,
  };

  // X axis is keyed on the unique ISO `date` (not the display label, which can
  // repeat across years) so overlay bands/markers map to the right position.
  const barXAxisProps = {
    dataKey: "date",
    tickFormatter: formatChartDate,
    tick: { fontSize: 11, fill: "var(--text-muted)" },
    tickLine: false,
    axisLine: { stroke: "var(--border)" },
    interval: tickInterval,
  };

  const lineXAxisProps = {
    dataKey: "date",
    tick: <LongRangeTick data={data} />,
    tickLine: false,
    axisLine: { stroke: "var(--border)" },
    interval: 0,
  };

  // Behind the data: school-holiday bands, weekend bands, forecast region.
  const sharedOverlays = (
    <>
      {schoolSegments.map((s, i) => (
        <ReferenceArea
          key={`school-${i}`}
          x1={s.x1}
          x2={s.x2}
          fill="var(--holiday)"
          fillOpacity={0.65}
          strokeOpacity={0}
        />
      ))}
      {weekendSegments.map((s, i) => (
        <ReferenceArea
          key={`weekend-${i}`}
          x1={s.x1}
          x2={s.x2}
          fill="#000000"
          fillOpacity={0.30}
          strokeOpacity={0}
        />
      ))}
      {hasForecastData && (
        <ReferenceArea
          x1={data[forecastStartIdx]?.date}
          x2={data[data.length - 1]?.date}
          fill="rgba(3, 23, 140, 0.03)"
          strokeOpacity={0}
        />
      )}
    </>
  );

  const chartHeading = "Daily Revenue";
  const forecastTrendColor =
    data.find((d) => d.type === "forecast")?.trendColor || "var(--good)";

  return (
    <div className="chart-section">
      <div className="chart-header">
        <h2 className="chart-heading">{chartHeading}</h2>
        <div className="chart-header-controls">
          <label className="forecast-switch forecast-switch-holiday">
            <input
              type="checkbox"
              checked={showHolidays}
              onChange={onToggleHolidays}
            />
            <span className="forecast-switch-track">
              <span className="forecast-switch-knob" />
            </span>
            Show Holidays
          </label>
          <div className="date-range-selector">
            {DATE_RANGES.map((r) => (
              <button
                key={r.key}
                className={`date-range-btn ${dateRange === r.key ? "active" : ""}`}
                onClick={() => onDateRangeChange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        {useLineChart ? (
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis {...lineXAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip
              content={
                <CustomTooltip showHolidays={showHolidays} />
              }
            />
            {sharedOverlays}
            <Line
              dataKey="actual"
              stroke="var(--accent)"
              dot={false}
              strokeWidth={1.5}
            />
            {showForecast && (
              <Line
                dataKey="forecast"
                stroke={forecastTrendColor}
                dot={false}
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
            )}
          </LineChart>
        ) : (
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis {...barXAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip
              content={
                <CustomTooltip showHolidays={showHolidays} />
              }
              cursor={{ fill: "rgba(0, 0, 0, 0.04)" }}
            />
            {sharedOverlays}
            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={
                    showHolidays && entry.publicHoliday && !entry.isBridge
                      ? "var(--holiday)"
                      : entry.trendColor || "var(--accent)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>

      <div className="chart-legend">
        <div className="chart-legend-item">
          <span
            className="chart-legend-swatch"
            style={{ background: "var(--accent)" }}
          />
          Actual
        </div>
        {showForecast && (
          <div className="chart-legend-item">
            <span
              className="chart-legend-swatch"
              style={{ background: forecastTrendColor }}
            />
            Forecast
          </div>
        )}
        {showHolidays && (
          <div className="chart-legend-item">
            <span className="chart-legend-swatch school" />
            School holidays
          </div>
        )}
        {showHolidays && (dateRange === "1m" || dateRange === "6m") && (
          <div className="chart-legend-item">
            <span className="chart-legend-swatch public" />
            Public holiday
          </div>
        )}
        {showHolidays && (dateRange === "1m" || dateRange === "6m") && (
          <div className="chart-legend-item">
            <span className="chart-legend-swatch weekend" />
            Weekend
          </div>
        )}
      </div>
    </div>
  );
}
