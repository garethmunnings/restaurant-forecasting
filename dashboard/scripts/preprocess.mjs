/**
 * Pre-processes the large sales CSV (~1.7M rows) into an aggregated JSON file
 * that the React dashboard can load efficiently.
 *
 * Output: public/sales_data.json
 * Structure:
 * {
 *   restaurants: [{ id, brand, province }],
 *   dailySales: {
 *     "restaurantId": [{ date, totalSales }]
 *   }
 * }
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const FORECAST_CSV = join(
  __dirname,
  "..",
  "..",
  "forecast",
  "output",
  "july_forecast.csv"
);
const OUT_DIR = join(__dirname, "..", "public");

// Read restaurants
const restaurantCsv = readFileSync(
  join(DATA_DIR, "spur_reporting.student_program.restaurant.csv"),
  "utf-8"
);
const restaurantLines = restaurantCsv.trim().split(/\r?\n/);
const restaurants = restaurantLines.slice(1).map((line) => {
  const [restaurant_id, brand, province] = line.split(",");
  return { id: parseInt(restaurant_id), brand, province };
});

console.log(`Loaded ${restaurants.length} restaurants`);

// Read pre-aggregated daily revenue (already zero-filled by forecast/aggregate.py)
// Header: restaurant_id,date,revenue,brand,province,day_of_week
const aggCsv = readFileSync(
  join(DATA_DIR, "aggregated_daily_revenue.csv"),
  "utf-8"
);
const aggLines = aggCsv.trim().split(/\r?\n/);

const dailySalesArrays = {};
for (const line of aggLines.slice(1)) {
  const parts = line.split(",");
  const restaurantId = parts[0];
  const date = parts[1].substring(0, 10); // strip timestamp portion
  const revenue = parseFloat(parts[2]) || 0;

  if (!dailySalesArrays[restaurantId]) {
    dailySalesArrays[restaurantId] = [];
  }
  dailySalesArrays[restaurantId].push({
    date,
    totalSales: Math.round(revenue * 100) / 100,
  });
}

// Sort each restaurant's entries by date
for (const arr of Object.values(dailySalesArrays)) {
  arr.sort((a, b) => a.date.localeCompare(b.date));
}

const totalRows = aggLines.length - 1;
console.log(`Total rows loaded from aggregated CSV: ${totalRows}`);

// Read July 2025 forecast (forecast/output/july_forecast.csv)
// restaurant_id,date,predicted_revenue
const forecast = {}; // { restaurantId: [{ date, predictedRevenue }] }
try {
  const forecastCsv = readFileSync(FORECAST_CSV, "utf-8");
  const forecastLines = forecastCsv.trim().split(/\r?\n/);
  forecastLines.slice(1).forEach((line) => {
    const [restaurantId, date, predicted] = line.split(",");
    if (!forecast[restaurantId]) forecast[restaurantId] = [];
    forecast[restaurantId].push({
      date,
      predictedRevenue: Math.round(parseFloat(predicted) * 100) / 100,
    });
  });
  for (const arr of Object.values(forecast)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  const forecastRows = Object.values(forecast).reduce(
    (s, arr) => s + arr.length,
    0
  );
  console.log(
    `Loaded forecast: ${forecastRows} rows across ${Object.keys(forecast).length} restaurants`
  );
} catch (err) {
  console.warn(`Could not load forecast CSV (${FORECAST_CSV}): ${err.message}`);
}

// Read SA school + public holidays (data/sa_school_holidays.csv)
// year,cluster,holiday_name,type,start_date,end_date
// cluster is inland/coastal only in 2023; 2024-2025 use "all". Including
// cluster in {all, inland} covers every holiday exactly once (no 2023 duplicates).
const holidays = { school: [], public: [] };
try {
  const holidayCsv = readFileSync(
    join(DATA_DIR, "sa_school_holidays.csv"),
    "utf-8"
  );
  const holidayLines = holidayCsv.trim().split(/\r?\n/);
  holidayLines.slice(1).forEach((line) => {
    const [, cluster, name, type, start, end] = line.split(",");
    if (cluster !== "all" && cluster !== "inland") return;
    if (type === "school_holiday" || type === "special_school_holiday") {
      holidays.school.push({ name, start, end });
    } else if (type === "public_holiday") {
      holidays.public.push({ date: start, name });
    }
  });
  holidays.school.sort((a, b) => a.start.localeCompare(b.start));
  holidays.public.sort((a, b) => a.date.localeCompare(b.date));
  console.log(
    `Loaded holidays: ${holidays.school.length} school, ${holidays.public.length} public`
  );
} catch (err) {
  console.warn(`Could not load holidays CSV: ${err.message}`);
}

const output = {
  restaurants,
  dailySales: dailySalesArrays,
  forecast,
  holidays,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "sales_data.json"), JSON.stringify(output));

const fileSizeMB = (
  Buffer.byteLength(JSON.stringify(output)) /
  1024 /
  1024
).toFixed(2);
console.log(`\nOutput written to public/sales_data.json (${fileSizeMB} MB)`);
console.log(
  `Date range per restaurant: ${Object.values(dailySalesArrays)
    .map(
      (arr) =>
        `${arr[0]?.date} - ${arr[arr.length - 1]?.date} (${arr.length} days)`
    )
    .join(", ")
    .substring(0, 200)}...`
);
