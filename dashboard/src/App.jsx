import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import "./App.css";

const formatCurrency = (val) =>
  `R ${val.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatNumber = (val) => val.toLocaleString("en-ZA");

const AGGREGATION_OPTIONS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

function aggregateData(data, aggLevel) {
  if (aggLevel === "daily") return data;

  const buckets = {};
  data.forEach((d) => {
    let key;
    if (aggLevel === "weekly") {
      // ISO week: group by Monday of each week
      const dt = new Date(d.date);
      const day = dt.getDay();
      const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(dt.setDate(diff));
      key = monday.toISOString().substring(0, 10);
    } else {
      // monthly
      key = d.date.substring(0, 7);
    }

    if (!buckets[key]) {
      buckets[key] = {
        totalSales: 0,
        transactionCount: 0,
        participantCount: 0,
        forecastSales: 0,
        hasActual: false,
        hasForecast: false,
      };
    }
    const b = buckets[key];
    if (d.totalSales != null) {
      b.totalSales += d.totalSales;
      b.hasActual = true;
    }
    b.transactionCount += d.transactionCount || 0;
    b.participantCount += d.participantCount || 0;
    if (d.forecastSales != null) {
      b.forecastSales += d.forecastSales;
      b.hasForecast = true;
    }
  });

  return Object.entries(buckets)
    .map(([date, b]) => ({
      date,
      totalSales: b.hasActual ? Math.round(b.totalSales * 100) / 100 : undefined,
      transactionCount: b.transactionCount,
      avgSale: b.transactionCount
        ? Math.round((b.totalSales / b.transactionCount) * 100) / 100
        : undefined,
      participantCount: b.participantCount,
      forecastSales: b.hasForecast
        ? Math.round(b.forecastSales * 100) / 100
        : undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-date">{label}</div>
      {payload.map((p, i) => (
        <div className="tooltip-row" key={i}>
          <span className="tooltip-label" style={{ color: p.color }}>
            {p.name}
          </span>
          <span className="tooltip-value">
            {p.name.includes("Sales") ||
            p.name.includes("Avg") ||
            p.name.includes("Forecast")
              ? formatCurrency(p.value)
              : formatNumber(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRestaurant, setSelectedRestaurant] = useState("all");
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2025-07-31");
  const [aggregation, setAggregation] = useState("daily");
  const [quickRange, setQuickRange] = useState("Jul '25");
  const [showForecast, setShowForecast] = useState(true);

  useEffect(() => {
    fetch("/sales_data.json")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  const setDateRange = useCallback((start, end, label) => {
    setStartDate(start);
    setEndDate(end);
    setQuickRange(label);
  }, []);

  const filteredData = useMemo(() => {
    if (!data) return [];

    const dateMap = {};

    const addHistory = (days) => {
      days.forEach((d) => {
        if (d.date >= startDate && d.date <= endDate) {
          if (!dateMap[d.date]) dateMap[d.date] = { date: d.date };
          const row = dateMap[d.date];
          row.totalSales = (row.totalSales || 0) + d.totalSales;
          row.transactionCount = (row.transactionCount || 0) + d.transactionCount;
          row.participantCount = (row.participantCount || 0) + d.participantCount;
        }
      });
    };

    const addForecast = (days) => {
      if (!showForecast) return;
      days.forEach((d) => {
        if (d.date >= startDate && d.date <= endDate) {
          if (!dateMap[d.date]) dateMap[d.date] = { date: d.date };
          dateMap[d.date].forecastSales =
            (dateMap[d.date].forecastSales || 0) + d.predictedRevenue;
        }
      });
    };

    if (selectedRestaurant === "all") {
      Object.values(data.dailySales).forEach(addHistory);
      Object.values(data.forecast || {}).forEach(addForecast);
    } else {
      addHistory(data.dailySales[selectedRestaurant] || []);
      addForecast(data.forecast?.[selectedRestaurant] || []);
    }

    let combined = Object.values(dateMap)
      .map((d) => ({
        ...d,
        avgSale: d.transactionCount
          ? Math.round((d.totalSales / d.transactionCount) * 100) / 100
          : undefined,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const result = aggregateData(combined, aggregation);

    // Bridge the forecast line to the last actual point so it reads as
    // one continuous flow rather than a floating segment.
    if (showForecast) {
      let lastActual = -1;
      for (let i = 0; i < result.length; i++) {
        if (result[i].totalSales != null) lastActual = i;
      }
      if (
        lastActual >= 0 &&
        lastActual < result.length - 1 &&
        result[lastActual].forecastSales == null
      ) {
        result[lastActual] = {
          ...result[lastActual],
          forecastSales: result[lastActual].totalSales,
        };
      }
    }

    return result;
  }, [data, selectedRestaurant, startDate, endDate, aggregation, showForecast]);

  // Manager-facing KPIs, computed from the raw (unaggregated) series so they
  // are independent of the chart's date-range / aggregation controls.
  const kpis = useMemo(() => {
    if (!data) return null;

    let forecastSeries = [];
    let historySeries = [];

    if (selectedRestaurant === "all") {
      const fm = {};
      Object.values(data.forecast || {}).forEach((arr) =>
        arr.forEach((d) => {
          fm[d.date] = (fm[d.date] || 0) + d.predictedRevenue;
        })
      );
      forecastSeries = Object.entries(fm)
        .map(([date, v]) => ({ date, v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const hm = {};
      Object.values(data.dailySales).forEach((arr) =>
        arr.forEach((d) => {
          hm[d.date] = (hm[d.date] || 0) + d.totalSales;
        })
      );
      historySeries = Object.entries(hm)
        .map(([date, v]) => ({ date, v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } else {
      forecastSeries = (data.forecast?.[selectedRestaurant] || []).map((d) => ({
        date: d.date,
        v: d.predictedRevenue,
      }));
      historySeries = (data.dailySales[selectedRestaurant] || []).map((d) => ({
        date: d.date,
        v: d.totalSales,
      }));
    }

    if (!forecastSeries.length) return null;

    const vals = forecastSeries.map((d) => d.v);
    const monthTotal = vals.reduce((s, v) => s + v, 0);
    const sorted = [...vals].sort((a, b) => a - b);
    const typicalDay = sorted[Math.floor(sorted.length / 2)];

    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const weekend = [];
    const weekday = [];
    forecastSeries.forEach((d) => {
      const g = new Date(d.date).getDay(); // 0 Sun .. 6 Sat
      (g === 0 || g === 6 ? weekend : weekday).push(d.v);
    });

    const runRate = avg(historySeries.slice(-14).map((d) => d.v));

    return {
      monthTotal,
      typicalDay,
      weekendAvg: avg(weekend),
      weekdayAvg: avg(weekday),
      runRate,
    };
  }, [data, selectedRestaurant]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading sales data...</p>
      </div>
    );
  }

  const restaurantLabel = selectedRestaurant === "all"
    ? "All Restaurants"
    : (() => {
        const r = data.restaurants.find((r) => String(r.id) === selectedRestaurant);
        return r ? `Restaurant ${r.id} (${r.province})` : `Restaurant ${selectedRestaurant}`;
      })();

  return (
    <div className="app">
      <header className="header">
        <h1>Spur Sales Dashboard</h1>
        <p>Historical sales explorer — {restaurantLabel}</p>
      </header>

      {/* Controls */}
      <div className="controls">
        <div className="control-group">
          <label htmlFor="restaurant-select">Restaurant</label>
          <select
            id="restaurant-select"
            value={selectedRestaurant}
            onChange={(e) => setSelectedRestaurant(e.target.value)}
          >
            <option value="all">All Restaurants</option>
            {data.restaurants.map((r) => (
              <option key={r.id} value={String(r.id)}>
                Restaurant {r.id} — {r.province}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="start-date">From</label>
          <input
            type="date"
            id="start-date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setQuickRange(null); }}
          />
        </div>

        <div className="control-group">
          <label htmlFor="end-date">To</label>
          <input
            type="date"
            id="end-date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setQuickRange(null); }}
          />
        </div>

        <div className="control-group">
          <label>Aggregation</label>
          <div className="agg-toggle">
            {AGGREGATION_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={aggregation === opt.key ? "active" : ""}
                onClick={() => setAggregation(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label>Forecast</label>
          <div className="agg-toggle">
            <button
              className={showForecast ? "active" : ""}
              onClick={() => setShowForecast((s) => !s)}
            >
              {showForecast ? "July forecast: ON" : "July forecast: OFF"}
            </button>
          </div>
        </div>

        <div className="control-group">
          <label>Quick Range</label>
          <div className="quick-ranges">
            {[
              { label: "Jul '25", start: "2025-01-01", end: "2025-07-31" },
              { label: "2023", start: "2023-01-01", end: "2023-12-31" },
              { label: "2024", start: "2024-01-01", end: "2024-12-31" },
              { label: "2025", start: "2025-01-01", end: "2025-07-31" },
              { label: "All", start: "2023-01-01", end: "2025-07-31" },
            ].map((r) => (
              <button
                key={r.label}
                className={quickRange === r.label ? "active" : ""}
                onClick={() => setDateRange(r.start, r.end, r.label)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs — July 2025 forecast, manager-facing */}
      {kpis && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Forecast July Total</div>
            <div className="kpi-value">{formatCurrency(kpis.monthTotal)}</div>
            <div className="kpi-sub">projected revenue, all 31 days</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Typical Forecast Day</div>
            <div className="kpi-value">{formatCurrency(kpis.typicalDay)}</div>
            <div className="kpi-sub">median day in July</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Weekend vs Weekday</div>
            <div className="kpi-value">{formatCurrency(kpis.weekendAvg)}</div>
            <div className="kpi-sub">
              weekend avg · weekday {formatCurrency(kpis.weekdayAvg)}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Latest Run-Rate</div>
            <div className="kpi-value">{formatCurrency(kpis.runRate)}</div>
            <div className="kpi-sub">avg of last 14 trading days</div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="chart-section">
        <h3>
          Revenue Over Time
          <span className="chart-subtitle">
            ({aggregation}) — actuals to 30 Jun, forecast for July
          </span>
        </h3>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis
              tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11 }}
              width={65}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="totalSales"
              name="Actual Sales"
              stroke="var(--chart-1)"
              fill="url(#salesGradient)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-1)" }}
            />
            {showForecast && (
              <Area
                type="monotone"
                dataKey="forecastSales"
                name="July Forecast"
                stroke="var(--chart-3, #e67e22)"
                fill="none"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4, fill: "var(--chart-3, #e67e22)" }}
                connectNulls
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="charts-grid">
        <div className="chart-section">
          <h3>
            Transaction Count
            <span className="chart-subtitle">({aggregation})</span>
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={filteredData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="transactionCount"
                name="Transactions"
                fill="var(--chart-2)"
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-section">
          <h3>
            Average Sale Value
            <span className="chart-subtitle">({aggregation})</span>
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={filteredData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tickFormatter={(v) => `R${v.toFixed(0)}`}
                tick={{ fontSize: 11 }}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="avgSale"
                name="Avg Sale"
                stroke="var(--chart-4)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "var(--chart-4)" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default App;
