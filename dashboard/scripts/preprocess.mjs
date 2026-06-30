/**
 * Pre-processes the large sales CSV (~1.7M rows) into an aggregated JSON file
 * that the React dashboard can load efficiently.
 *
 * Output: public/sales_data.json
 * Structure:
 * {
 *   restaurants: [{ id, brand, province }],
 *   dailySales: {
 *     "restaurantId": [{ date, totalSales, transactionCount, avgSale, participantCount }]
 *   }
 * }
 */

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from "fs";
import { createInterface } from "readline";
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

// Aggregate sales by restaurant + date (daily)
// sale_id,restaurant_id,sale_at,amount,participant_count,loyalty_account_count,voucher_redeemer_count,had_voucher
const dailySales = {}; // { restaurantId: { date: { totalSales, count, participants } } }

const rl = createInterface({
  input: createReadStream(
    join(DATA_DIR, "spur_reporting.student_program.sale.csv")
  ),
  crlfDelay: Infinity,
});

let lineCount = 0;
let isHeader = true;

for await (const line of rl) {
  if (isHeader) {
    isHeader = false;
    continue;
  }
  lineCount++;

  // Parse CSV line (no quoted fields in this data)
  const parts = line.split(",");
  const restaurantId = parts[1];
  const saleAt = parts[2]; // "2023-01-01 05:45:05.567608 +00:00"
  const amount = parseFloat(parts[3]);
  const participantCount = parseInt(parts[4]);

  // Extract date (YYYY-MM-DD)
  const date = saleAt.substring(0, 10);

  if (!dailySales[restaurantId]) {
    dailySales[restaurantId] = {};
  }
  if (!dailySales[restaurantId][date]) {
    dailySales[restaurantId][date] = {
      totalSales: 0,
      count: 0,
      participants: 0,
    };
  }

  const day = dailySales[restaurantId][date];
  day.totalSales += amount;
  day.count += 1;
  day.participants += participantCount;

  if (lineCount % 250000 === 0) {
    console.log(`  Processed ${lineCount} rows...`);
  }
}

console.log(`Total rows processed: ${lineCount}`);

// Convert to sorted arrays
const dailySalesArrays = {};
for (const [restaurantId, dates] of Object.entries(dailySales)) {
  dailySalesArrays[restaurantId] = Object.entries(dates)
    .map(([date, data]) => ({
      date,
      totalSales: Math.round(data.totalSales * 100) / 100,
      transactionCount: data.count,
      avgSale: Math.round((data.totalSales / data.count) * 100) / 100,
      participantCount: data.participants,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

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

const output = {
  restaurants,
  dailySales: dailySalesArrays,
  forecast,
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
