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
      buckets[key] = { totalSales: 0, transactionCount: 0, participantCount: 0 };
    }
    buckets[key].totalSales += d.totalSales;
    buckets[key].transactionCount += d.transactionCount;
    buckets[key].participantCount += d.participantCount;
  });

  return Object.entries(buckets)
    .map(([date, d]) => ({
      date,
      totalSales: Math.round(d.totalSales * 100) / 100,
      transactionCount: d.transactionCount,
      avgSale: Math.round((d.totalSales / d.transactionCount) * 100) / 100,
      participantCount: d.participantCount,
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
            {p.name.includes("Sales") || p.name.includes("Avg")
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
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState("2025-06-30");
  const [aggregation, setAggregation] = useState("monthly");
  const [quickRange, setQuickRange] = useState(null);

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

    let combined = [];

    if (selectedRestaurant === "all") {
      // Merge all restaurants into combined daily totals
      const dateMap = {};
      Object.values(data.dailySales).forEach((days) => {
        days.forEach((d) => {
          if (d.date >= startDate && d.date <= endDate) {
            if (!dateMap[d.date]) {
              dateMap[d.date] = { totalSales: 0, transactionCount: 0, participantCount: 0 };
            }
            dateMap[d.date].totalSales += d.totalSales;
            dateMap[d.date].transactionCount += d.transactionCount;
            dateMap[d.date].participantCount += d.participantCount;
          }
        });
      });
      combined = Object.entries(dateMap)
        .map(([date, d]) => ({
          date,
          totalSales: d.totalSales,
          transactionCount: d.transactionCount,
          avgSale: Math.round((d.totalSales / d.transactionCount) * 100) / 100,
          participantCount: d.participantCount,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } else {
      const days = data.dailySales[selectedRestaurant] || [];
      combined = days.filter((d) => d.date >= startDate && d.date <= endDate);
    }

    return aggregateData(combined, aggregation);
  }, [data, selectedRestaurant, startDate, endDate, aggregation]);

  const kpis = useMemo(() => {
    if (!filteredData.length) return null;
    const totalSales = filteredData.reduce((s, d) => s + d.totalSales, 0);
    const totalTx = filteredData.reduce((s, d) => s + d.transactionCount, 0);
    const totalParticipants = filteredData.reduce((s, d) => s + d.participantCount, 0);
    const avgSale = totalTx > 0 ? totalSales / totalTx : 0;
    const days = filteredData.length;
    return { totalSales, totalTx, avgSale, totalParticipants, days };
  }, [filteredData]);

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
          <label>Quick Range</label>
          <div className="quick-ranges">
            {[
              { label: "2023", start: "2023-01-01", end: "2023-12-31" },
              { label: "2024", start: "2024-01-01", end: "2024-12-31" },
              { label: "2025", start: "2025-01-01", end: "2025-06-30" },
              { label: "Last 6M", start: "2025-01-01", end: "2025-06-30" },
              { label: "All", start: "2023-01-01", end: "2025-06-30" },
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

      {/* KPIs */}
      {kpis && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total Revenue</div>
            <div className="kpi-value">{formatCurrency(kpis.totalSales)}</div>
            <div className="kpi-sub">{kpis.days} {aggregation} periods</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Transactions</div>
            <div className="kpi-value">{formatNumber(kpis.totalTx)}</div>
            <div className="kpi-sub">
              Avg {formatNumber(Math.round(kpis.totalTx / kpis.days))} / {aggregation === "daily" ? "day" : aggregation === "weekly" ? "week" : "month"}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg Sale Value</div>
            <div className="kpi-value">{formatCurrency(kpis.avgSale)}</div>
            <div className="kpi-sub">per transaction</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total Participants</div>
            <div className="kpi-value">{formatNumber(kpis.totalParticipants)}</div>
            <div className="kpi-sub">
              Avg {(kpis.totalParticipants / kpis.totalTx).toFixed(1)} per transaction
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="chart-section">
        <h3>
          Revenue Over Time
          <span className="chart-subtitle">({aggregation})</span>
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
            <Area
              type="monotone"
              dataKey="totalSales"
              name="Total Sales"
              stroke="var(--chart-1)"
              fill="url(#salesGradient)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-1)" }}
            />
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
