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
    return `R ${(value / 1_000_000).toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    return `R ${(value / 1_000).toFixed(0)}k`;
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

function formatChartDate(dateStr) {
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

function computeFleetAverage(dailySales) {
  const byDate = {};
  const countByDate = {};
  for (const restId of Object.keys(dailySales)) {
    for (const entry of dailySales[restId]) {
      if (!byDate[entry.date]) {
        byDate[entry.date] = 0;
        countByDate[entry.date] = 0;
      }
      byDate[entry.date] += entry.totalSales;
      countByDate[entry.date] += 1;
    }
  }
  const result = {};
  for (const date of Object.keys(byDate)) {
    result[date] = byDate[date] / countByDate[date];
  }
  return result;
}

// ─── Chart Data ────────────────────────────────────────────

const ACTUAL_CUTOFF = "2025-06-30";
const FORECAST_START = "2025-07-01";

export function buildChartData(
  dailySales,
  forecast,
  selectedRestaurant,
  showForecast,
  dateRange = "6m"
) {
  if (!dailySales) return [];

  let actuals;
  let averageMap = null;

  if (selectedRestaurant === "all") {
    actuals = aggregateAllRestaurants(dailySales);
  } else {
    actuals = (dailySales[selectedRestaurant] || []).map((d) => ({
      date: d.date,
      totalSales: d.totalSales,
    }));
    averageMap = computeFleetAverage(dailySales);
  }

  // Filter actuals based on selected date range
  const cutoffDate = parseDate(ACTUAL_CUTOFF);
  let windowStartStr;
  if (dateRange === "all") {
    windowStartStr = "2000-01-01";
  } else {
    const daysBack = dateRange === "1m" ? 30 : dateRange === "1y" ? 365 : 180;
    const windowStart = new Date(cutoffDate);
    windowStart.setDate(windowStart.getDate() - (daysBack - 1));
    windowStartStr = windowStart.toISOString().slice(0, 10);
  }

  const filtered = actuals.filter(
    (d) => d.date >= windowStartStr && d.date <= ACTUAL_CUTOFF
  );

  const result = filtered.map((d) => {
    const point = {
      date: d.date,
      dateLabel: formatChartDate(d.date),
      actual: Math.round(d.totalSales),
      forecast: null,
    };
    if (averageMap && averageMap[d.date] != null) {
      point.average = Math.round(averageMap[d.date]);
    }
    return point;
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

    // Bridge: add last actual as first forecast point
    if (result.length > 0 && forecastData.length > 0) {
      const lastActual = result[result.length - 1];
      result.push({
        date: lastActual.date,
        dateLabel: lastActual.dateLabel,
        actual: null,
        forecast: lastActual.actual,
        average: lastActual.average || null,
        isBridge: true,
      });
    }

    for (const entry of forecastData) {
      const point = {
        date: entry.date,
        dateLabel: formatChartDate(entry.date),
        actual: null,
        forecast: Math.round(entry.predictedRevenue),
      };
      if (averageMap && averageMap[entry.date] != null) {
        point.average = Math.round(averageMap[entry.date]);
      }
      result.push(point);
    }
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
