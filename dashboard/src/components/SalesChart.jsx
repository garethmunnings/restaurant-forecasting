import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { formatCurrency, formatAxisValue } from "../utils/dataHelpers.js";

function CustomTooltip({ active, payload, showAverage }) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="custom-tooltip">
      <div className="tooltip-date">{data.dateLabel}</div>
      {data.actual != null && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "#03178C" }} />
          Actual: {formatCurrency(data.actual)}
        </div>
      )}
      {data.forecast != null && !data.isBridge && (
        <div className="tooltip-row">
          <span
            className="tooltip-dot"
            style={{ background: "rgba(3, 23, 140, 0.6)" }}
          />
          Forecast: {formatCurrency(data.forecast)}
        </div>
      )}
      {showAverage && data.average != null && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "#6B7280" }} />
          Fleet Avg: {formatCurrency(data.average)}
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

export default function SalesChart({ data, showForecast, showAverage, dateRange, onDateRangeChange }) {
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

  const sharedAxisProps = {
    xAxis: {
      dataKey: "dateLabel",
      tick: { fontSize: 11, fill: "#6B7280" },
      tickLine: false,
      axisLine: { stroke: "#E0E0E0" },
      interval: tickInterval,
    },
    yAxis: {
      tickFormatter: formatAxisValue,
      tick: { fontSize: 11, fill: "#6B7280" },
      tickLine: false,
      axisLine: false,
      width: 60,
    },
  };

  const sharedOverlays = (
    <>
      {hasForecastData && (
        <ReferenceArea
          x1={data[forecastStartIdx]?.dateLabel}
          x2={data[data.length - 1]?.dateLabel}
          fill="rgba(3, 23, 140, 0.03)"
          strokeOpacity={0}
        />
      )}
      {hasForecastData && (
        <ReferenceLine
          x={data[forecastStartIdx]?.dateLabel}
          stroke="#03178C"
          strokeDasharray="4 4"
          strokeOpacity={0.3}
        />
      )}
    </>
  );

  return (
    <div className="chart-section">
      <div className="chart-header">
        <h2 className="chart-heading">Daily Revenue</h2>
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
      <ResponsiveContainer width="100%" height={360}>
        {useLineChart ? (
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#E0E0E0"
              vertical={false}
            />
            <XAxis {...sharedAxisProps.xAxis} />
            <YAxis {...sharedAxisProps.yAxis} />
            <Tooltip
              content={<CustomTooltip showAverage={showAverage} />}
            />
            {sharedOverlays}
            <Line
              dataKey="actual"
              stroke="#03178C"
              dot={false}
              strokeWidth={1.5}
            />
            {showForecast && (
              <Line
                dataKey="forecast"
                stroke="rgba(3, 23, 140, 0.6)"
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
              stroke="#E0E0E0"
              vertical={false}
            />
            <XAxis {...sharedAxisProps.xAxis} />
            <YAxis {...sharedAxisProps.yAxis} />
            <Tooltip
              content={<CustomTooltip showAverage={showAverage} />}
              cursor={{ fill: "rgba(0, 0, 0, 0.04)" }}
            />
            {sharedOverlays}
            <Bar
              dataKey="actual"
              fill="#03178C"
              radius={[2, 2, 0, 0]}
            />
            {showForecast && (
              <Bar
                dataKey="forecast"
                fill="rgba(3, 23, 140, 0.4)"
                radius={[2, 2, 0, 0]}
              />
            )}
          </BarChart>
        )}
      </ResponsiveContainer>

      <div className="chart-legend">
        <div className="chart-legend-item">
          <span className="chart-legend-line actual" />
          Actual
        </div>
        {showForecast && (
          <div className="chart-legend-item">
            <span className="chart-legend-line forecast" />
            Forecast
          </div>
        )}
        {showAverage && (
          <div className="chart-legend-item">
            <span className="chart-legend-line average" />
            Fleet Average
          </div>
        )}
      </div>
    </div>
  );
}
