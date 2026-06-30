/**
 * Data transformation, KPI computation, summary text, and formatting utilities.
 * All logic for deriving dashboard state from raw sales_data.json lives here.
 */

// ─── Formatting ────────────────────────────────────────────

const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value) {
  if (value == null || isNaN(value)) return "R 0";
  return zarFormatter.format(value);
}

export function formatCompactCurrency(value) {
  if (value == null || isNaN(value)) return "R 0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R${(value / 1_000_000).toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    return `R${(value / 1_000).toFixed(0)}k`;
  }
  return formatCurrency(value);
}

export function formatAxisValue(value) {
  if (value == null) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

// ─── Date helpers ──────────────────────────────────────────

function parseDate(dateStr) {
  // Handle "YYYY-MM-DD" — avoid timezone shifts by parsing as UTC components
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatChartDate(dateStr) {
  const d = parseDate(dateStr);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function getDayOfWeek(dateStr) {
  return parseDate(dateStr).getDay(); // 0=Sun, 6=Sat
}

function isWeekend(dateStr) {
  const dow = getDayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

// ─── Holiday lookups ───────────────────────────────────────
// Dates are "YYYY-MM-DD" strings, so lexical comparison is chronological.

function findSchoolHoliday(dateStr, school) {
  if (!school) return null;
  const match = school.find((h) => dateStr >= h.start && dateStr <= h.end);
  return match ? match.name : null;
}

function findPublicHoliday(dateStr, publicHols) {
  if (!publicHols) return null;
  const match = publicHols.find((h) => h.date === dateStr);
  return match ? match.name : null;
}

function annotateHolidays(point, holidays) {
  point.isWeekend = isWeekend(point.date);
  point.schoolHoliday = findSchoolHoliday(point.date, holidays?.school);
  point.publicHoliday = findPublicHoliday(point.date, holidays?.public);
  return point;
}

function getMonthDates(dailyData, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return dailyData.filter((d) => d.date.startsWith(prefix));
}

// ─── Aggregation ───────────────────────────────────────────

function aggregateAllRestaurants(dailySales) {
  const byDate = {};
  for (const restId of Object.keys(dailySales)) {
    for (const entry of dailySales[restId]) {
      if (!byDate[entry.date]) {
        byDate[entry.date] = 0;
      }
      byDate[entry.date] += entry.totalSales;
    }
  }
  return Object.entries(byDate)
    .map(([date, totalSales]) => ({ date, totalSales }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ─── Weekly Sampling ──────────────────────────────────────

function getMonday(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay(); // 0=Sun, 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const mon = new Date(d);
  mon.setDate(mon.getDate() + diff);
  const y = mon.getFullYear();
  const m = String(mon.getMonth() + 1).padStart(2, "0");
  const dd = String(mon.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function weeklyReps(points) {
  const weeks = new Map();
  for (const p of points) {
    const key = getMonday(p.date);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(p);
  }
  const reps = [];
  for (const [, pts] of weeks) {
    // Pick the middle day of the week as the representative sample
    reps.push(pts[Math.floor(pts.length / 2)]);
  }
  return reps;
}

function sampleWeekly(dailyData) {
  if (dailyData.length === 0) return [];

  // Bucket actuals and forecasts independently so the boundary week (which
  // straddles 30 Jun → 1 Jul) never mixes types and drops the last actual.
  const actualReps = weeklyReps(dailyData.filter((p) => p.type === "actual"));
  const forecastReps = weeklyReps(dailyData.filter((p) => p.type === "forecast"));

  // Connect the two lines: give the last actual representative a forecast value
  // equal to its own actual, so the forecast line's first vertex coincides exactly
  // with the actual line's last vertex (no gap on the category axis). isBridge keeps
  // the tooltip from showing a duplicate "Forecast" row on that boundary point.
  if (actualReps.length > 0 && forecastReps.length > 0) {
    const lastActual = actualReps[actualReps.length - 1];
    lastActual.forecast = lastActual.actual;
    lastActual.isBridge = true;
  }

  return [...actualReps, ...forecastReps];
}

// ─── Chart Data ────────────────────────────────────────────

const ACTUAL_CUTOFF = "2025-06-30";
const FORECAST_START = "2025-07-01";

// Start of the rolling window for a given date-range key, as a "YYYY-MM-DD"
// string anchored to ACTUAL_CUTOFF. Shared by chart, summary, and ranking.
function getWindowStartStr(dateRange) {
  if (dateRange === "all") return "2000-01-01";
  const daysBack = dateRange === "1m" ? 30 : dateRange === "1y" ? 365 : 180;
  const windowStart = new Date(parseDate(ACTUAL_CUTOFF));
  windowStart.setDate(windowStart.getDate() - (daysBack - 1));
  return windowStart.toISOString().slice(0, 10);
}

export function buildChartData(
  dailySales,
  forecast,
  selectedRestaurant,
  showForecast,
  dateRange = "6m",
  holidays = null
) {
  if (!dailySales) return [];

  let actuals;

  if (selectedRestaurant === "all") {
    actuals = aggregateAllRestaurants(dailySales);
  } else {
    actuals = (dailySales[selectedRestaurant] || []).map((d) => ({
      date: d.date,
      totalSales: d.totalSales,
    }));
  }

  // Filter actuals based on selected date range
  const windowStartStr = getWindowStartStr(dateRange);

  const filtered = actuals.filter(
    (d) => d.date >= windowStartStr && d.date <= ACTUAL_CUTOFF
  );

  const result = filtered.map((d) => {
    const actual = Math.round(d.totalSales);
    const point = {
      date: d.date,
      dateLabel: formatChartDate(d.date),
      actual,
      forecast: null,
      value: actual,
      type: "actual",
      trendColor: "var(--accent)",
    };
    return annotateHolidays(point, holidays);
  });

  if (showForecast && forecast) {
    let forecastData;
    if (selectedRestaurant === "all") {
      // Sum forecast across all restaurants
      const byDate = {};
      for (const restId of Object.keys(forecast)) {
        for (const entry of forecast[restId]) {
          if (!byDate[entry.date]) byDate[entry.date] = 0;
          byDate[entry.date] += entry.predictedRevenue;
        }
      }
      forecastData = Object.entries(byDate)
        .map(([date, val]) => ({ date, predictedRevenue: val }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    } else {
      forecastData = forecast[selectedRestaurant] || [];
    }

    // Determine overall forecast trend: compare total forecast to
    // trailing 14-day average projected over the same number of days
    const trailing14 = filtered.slice(-14);
    const dailyBaseline =
      trailing14.length > 0
        ? trailing14.reduce((s, d) => s + d.totalSales, 0) / trailing14.length
        : 0;
    const forecastTotal = forecastData.reduce((s, d) => s + d.predictedRevenue, 0);
    const baselineTotal = dailyBaseline * forecastData.length;
    const forecastColor = forecastTotal >= baselineTotal ? "var(--good)" : "var(--bad)";

    // The forecast line is connected to the actuals inside sampleWeekly (1y/all),
    // which anchors the forecast's first vertex onto the last actual representative.

    for (const entry of forecastData) {
      const rev = Math.round(entry.predictedRevenue);
      const point = {
        date: entry.date,
        dateLabel: formatChartDate(entry.date),
        actual: null,
        forecast: rev,
        value: rev,
        type: "forecast",
        trendColor: forecastColor,
      };
      result.push(annotateHolidays(point, holidays));
    }
  }

  // Weekly aggregation for 1y and all views
  if (dateRange === "1y" || dateRange === "all") {
    return sampleWeekly(result);
  }

  return result;
}

// ─── KPIs ──────────────────────────────────────────────────

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getMonthData(dailySales, selectedRestaurant, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  if (selectedRestaurant === "all") {
    const agg = aggregateAllRestaurants(dailySales);
    return agg.filter((d) => d.date.startsWith(prefix));
  }
  return (dailySales[selectedRestaurant] || []).filter((d) =>
    d.date.startsWith(prefix)
  );
}

function getForecastData(forecast, selectedRestaurant) {
  if (!forecast) return [];
  if (selectedRestaurant === "all") {
    const byDate = {};
    for (const restId of Object.keys(forecast)) {
      for (const entry of forecast[restId]) {
        if (!byDate[entry.date]) byDate[entry.date] = 0;
        byDate[entry.date] += entry.predictedRevenue;
      }
    }
    return Object.entries(byDate)
      .map(([date, val]) => ({ date, totalSales: val }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return (forecast[selectedRestaurant] || []).map((d) => ({
    date: d.date,
    totalSales: d.predictedRevenue,
  }));
}

export function computeKpis(
  dailySales,
  forecast,
  selectedRestaurant,
  showForecast
) {
  if (!dailySales) {
    return {
      total: 0,
      totalLabel: "",
      typicalDay: 0,
      weekendAvg: 0,
      weekdayAvg: 0,
      runRate: 0,
    };
  }

  if (showForecast && forecast) {
    const fData = getForecastData(forecast, selectedRestaurant);
    const values = fData.map((d) => d.totalSales);
    const weekendVals = fData
      .filter((d) => isWeekend(d.date))
      .map((d) => d.totalSales);
    const weekdayVals = fData
      .filter((d) => !isWeekend(d.date))
      .map((d) => d.totalSales);

    // Run-rate stays as trailing 14 days of actuals (anchor to reality)
    const juneData = getMonthData(dailySales, selectedRestaurant, 2025, 6);
    const last14 = juneData.slice(-14);
    const runRate =
      last14.length > 0
        ? last14.reduce((s, d) => s + d.totalSales, 0) / last14.length
        : 0;

    // Trend: compare July median to June median
    const julyMedian = median(values);
    const juneMedian = median(juneData.map((d) => d.totalSales));
    const typicalDayTrend =
      juneMedian === 0 ? "neutral" : julyMedian > juneMedian ? "up" : julyMedian < juneMedian ? "down" : "neutral";

    return {
      total: values.reduce((s, v) => s + v, 0),
      totalLabel: "July 2025 Forecast",
      typicalDay: julyMedian,
      typicalDayTrend,
      weekendAvg:
        weekendVals.length > 0
          ? weekendVals.reduce((s, v) => s + v, 0) / weekendVals.length
          : 0,
      weekdayAvg:
        weekdayVals.length > 0
          ? weekdayVals.reduce((s, v) => s + v, 0) / weekdayVals.length
          : 0,
      runRate,
    };
  }

  // Actuals mode — show June 2025
  const juneData = getMonthData(dailySales, selectedRestaurant, 2025, 6);
  const values = juneData.map((d) => d.totalSales);
  const weekendVals = juneData
    .filter((d) => isWeekend(d.date))
    .map((d) => d.totalSales);
  const weekdayVals = juneData
    .filter((d) => !isWeekend(d.date))
    .map((d) => d.totalSales);
  const last14 = juneData.slice(-14);

  // Trend: compare June median to May median
  const juneMedian = median(values);
  const mayData = getMonthData(dailySales, selectedRestaurant, 2025, 5);
  const mayMedian = median(mayData.map((d) => d.totalSales));
  const typicalDayTrend =
    mayMedian === 0 ? "neutral" : juneMedian > mayMedian ? "up" : juneMedian < mayMedian ? "down" : "neutral";

  return {
    total: values.reduce((s, v) => s + v, 0),
    totalLabel: "June 2025 Revenue",
    typicalDay: juneMedian,
    typicalDayTrend,
    weekendAvg:
      weekendVals.length > 0
        ? weekendVals.reduce((s, v) => s + v, 0) / weekendVals.length
        : 0,
    weekdayAvg:
      weekdayVals.length > 0
        ? weekdayVals.reduce((s, v) => s + v, 0) / weekdayVals.length
        : 0,
    runRate:
      last14.length > 0
        ? last14.reduce((s, d) => s + d.totalSales, 0) / last14.length
        : 0,
  };
}

// ─── Restaurant Ranking ────────────────────────────────────

const RANGE_LABELS = {
  "1m": "Last month",
  "6m": "Last 6 months",
  "1y": "Last year",
  all: "All time",
};

/**
 * Rank restaurants for the comparison panel.
 *
 * Forecast OFF → every restaurant by total revenue over the selected chart
 *   window (dateRange), highest first.
 * Forecast ON  → biggest movers by % change of the July forecast total vs
 *   June 2025 actuals: top 5 gainers and top 5 decliners.
 *
 * Returns a render-ready object, or null when data is missing.
 */
export function computeRanking(
  dailySales,
  forecast,
  restaurants,
  showForecast,
  dateRange = "6m"
) {
  if (!dailySales || !restaurants) return null;

  if (showForecast && forecast) {
    const movers = [];
    for (const r of restaurants) {
      const key = String(r.id);
      const juneData = getMonthData(dailySales, key, 2025, 6);
      const juneTotal = juneData.reduce((s, d) => s + d.totalSales, 0);
      if (juneTotal === 0) continue; // % change undefined — skip
      const julyTotal = (forecast[key] || []).reduce(
        (s, e) => s + e.predictedRevenue,
        0
      );
      const delta = julyTotal - juneTotal;
      movers.push({
        id: r.id,
        province: r.province,
        pct: (delta / juneTotal) * 100,
        delta,
      });
    }
    movers.sort((a, b) => b.pct - a.pct);
    const gainers = movers.filter((m) => m.pct > 0).slice(0, 5);
    const decliners = movers
      .filter((m) => m.pct < 0)
      .slice(-5)
      .reverse(); // most-negative first
    const maxAbsPct = Math.max(
      1,
      ...gainers.map((m) => m.pct),
      ...decliners.map((m) => Math.abs(m.pct))
    );
    return { mode: "forecast", gainers, decliners, maxAbsPct };
  }

  // Revenue mode — total over the selected window, every restaurant
  const windowStartStr = getWindowStartStr(dateRange);
  const rows = restaurants.map((r) => {
    const value = (dailySales[String(r.id)] || [])
      .filter((d) => d.date >= windowStartStr && d.date <= ACTUAL_CUTOFF)
      .reduce((s, d) => s + d.totalSales, 0);
    return { id: r.id, province: r.province, value };
  });
  rows.sort((a, b) => b.value - a.value);
  return {
    mode: "revenue",
    rangeLabel: RANGE_LABELS[dateRange] || RANGE_LABELS["6m"],
    rows,
    max: rows.length > 0 ? rows[0].value : 0,
  };
}

// ─── CSV Export ───────────────────────────────────────────

export function generateForecastCsv(forecast) {
  if (!forecast) return "";
  const lines = ["restaurant_id,date,predicted_revenue"];
  const ids = Object.keys(forecast).sort((a, b) => Number(a) - Number(b));
  for (const restId of ids) {
    for (const entry of forecast[restId]) {
      lines.push(`${restId},${entry.date},${entry.predictedRevenue}`);
    }
  }
  return lines.join("\n");
}

// ─── Summary Text ──────────────────────────────────────────

export function generateSummary(
  dailySales,
  forecast,
  selectedRestaurant,
  showForecast,
  dateRange = "6m"
) {
  if (!dailySales)
    return { text: "Loading sales data...", sentiment: "neutral" };

  if (showForecast && forecast) {
    const fData = getForecastData(forecast, selectedRestaurant);
    const julyTotal = fData.reduce((s, d) => s + d.totalSales, 0);
    const juneData = getMonthData(dailySales, selectedRestaurant, 2025, 6);
    const juneTotal = juneData.reduce((s, d) => s + d.totalSales, 0);

    if (juneTotal === 0) {
      return {
        text: `July forecast projects ${formatCompactCurrency(julyTotal)} total revenue.`,
        sentiment: "neutral",
      };
    }

    const pctChange = ((julyTotal - juneTotal) / juneTotal) * 100;
    const direction = pctChange >= 0 ? "above" : "below";
    const sentiment = pctChange >= 0 ? "good" : "bad";
    return {
      text: `July forecast projects ${formatCompactCurrency(julyTotal)}, ${Math.abs(pctChange).toFixed(0)}% ${direction} June actuals.`,
      sentiment,
    };
  }

  // Actuals mode — compare halves of the selected date range
  const rangeLabel =
    dateRange === "1m"
      ? "last month"
      : dateRange === "1y"
        ? "last year"
        : dateRange === "all"
          ? "all time"
          : "last 6 months";

  const cutoff = parseDate(ACTUAL_CUTOFF);
  let windowStart;
  if (dateRange === "all") {
    windowStart = new Date(0); // include everything
  } else {
    const daysBack = dateRange === "1m" ? 30 : dateRange === "1y" ? 365 : 180;
    windowStart = new Date(cutoff);
    windowStart.setDate(windowStart.getDate() - (daysBack - 1));
  }
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  let allData;
  if (selectedRestaurant === "all") {
    allData = aggregateAllRestaurants(dailySales);
  } else {
    allData = (dailySales[selectedRestaurant] || []).map((d) => ({
      date: d.date,
      totalSales: d.totalSales,
    }));
  }

  const windowData = allData.filter(
    (d) => d.date >= windowStartStr && d.date <= ACTUAL_CUTOFF
  );

  if (windowData.length === 0) {
    return { text: "No data for the selected period.", sentiment: "neutral" };
  }

  const mid = Math.floor(windowData.length / 2);
  const firstHalf = windowData.slice(0, mid);
  const secondHalf = windowData.slice(mid);
  const firstTotal = firstHalf.reduce((s, d) => s + d.totalSales, 0);
  const secondTotal = secondHalf.reduce((s, d) => s + d.totalSales, 0);

  if (firstTotal === 0) {
    return {
      text: `Revenue over the ${rangeLabel} totalled ${formatCompactCurrency(secondTotal)}.`,
      sentiment: "neutral",
    };
  }

  const pctChange = ((secondTotal - firstTotal) / firstTotal) * 100;
  if (Math.abs(pctChange) < 1) {
    return {
      text: `Revenue held steady over the ${rangeLabel} at ${formatCompactCurrency(secondTotal)}.`,
      sentiment: "neutral",
    };
  }

  const direction = pctChange > 0 ? "up" : "down";
  const sentiment = pctChange > 0 ? "good" : "bad";
  return {
    text: `Revenue is trending ${direction} ${Math.abs(pctChange).toFixed(0)}% over the ${rangeLabel}.`,
    sentiment,
  };
}
