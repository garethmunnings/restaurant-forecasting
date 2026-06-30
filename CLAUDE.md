# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stratech Signal Intelligence Student Programme exercise: forecast July 2025 daily restaurant sales for 22 Spur restaurants and present results in a manager-facing dashboard. The scenario assumes **today is 30 June 2025** — July has not happened yet.

### Deliverables

1. **Manager dashboard** — local React/Vite app showing historical sales and July forecast, switchable per restaurant, with financial KPIs aimed at non-technical restaurant managers.
2. **`july_forecast.csv`** — exactly 682 rows (22 restaurants x 31 days), columns: `restaurant_id` (int 1-22), `date` (YYYY-MM-DD, July 2025), `predicted_revenue` (ZAR, >= 0). No duplicates.

## Data

All source files live in `data/`. Revenue is in ZAR.

| File | Purpose |
|------|---------|
| `spur_reporting.student_program.sale.csv` (~1.7M rows) | One row per bill. `amount` is bill total. Only source for revenue sums. History ends 30 Jun 2025. |
| `spur_reporting.student_program.restaurant.csv` | 22 sites: `restaurant_id`, `brand` (all SPUR), `province`. |
| `spur_reporting.student_program.sale_customer.csv` | Bill-to-customer links. For count/signal features only — **never sum revenue from this file** (causes double-counting). |
| `spur_reporting.student_program.customer.csv` | Optional customer profile features. |
| `aggregated_daily_revenue.csv` | Pre-computed daily revenue per restaurant (output of `forecast/aggregate.py`). Includes zero-fill for missing days. |
| `sa_school_holidays.csv` | South African school holidays 2023-2025 with inland/coastal clusters. |
| `daily_revenue.csv` | Earlier aggregation variant (prefer `aggregated_daily_revenue.csv`). |
| `2023/2024/2025-school-holidays.pdf` | Source PDFs for holiday data. |

### Critical data pitfalls

- **Double-counting**: Joining `sale_customer` to `sale` and summing `amount` duplicates revenue.
- **Wrong date grain**: Timestamps include timezone offsets; truncate to date carefully (`.dt.normalize()` or `substring(0,10)`).
- **Dropping zero days**: Days with no sales are absent from raw data. The aggregation script fills these with R0 — do not skip this step.
- **Grain**: Forecast target is `SUM(amount)` per restaurant per calendar day, not per customer or bill.

## Architecture

```
task_1/
├── data/                    # Source CSVs and derived data files
├── forecast/                # Python forecasting pipeline
│   ├── aggregate.py         # Raw sales -> aggregated_daily_revenue.csv (zero-filled)
│   ├── explore.py           # Ad-hoc exploration script (restaurant 8 example)
│   └── output/              # Forecast model outputs
├── dashboard/               # React + Vite frontend
│   ├── scripts/preprocess.mjs  # Aggregates sale.csv -> public/sales_data.json
│   ├── src/App.jsx          # Main dashboard component (Recharts)
│   ├── src/index.css        # Styling
│   └── public/              # Static assets (sales_data.json generated here)
```

## Commands

### Dashboard (React/Vite)

```bash
cd dashboard

# Generate sales_data.json from raw CSVs (run once, or after data changes)
node scripts/preprocess.mjs

# Start dev server
npm run dev

# Production build
npm run build
```

### Forecast (Python)

```bash
cd forecast

# Regenerate aggregated daily revenue CSV
python aggregate.py

# Run exploration / ad-hoc analysis
python explore.py
```

## Dashboard Requirements (from spec)

- **Sales history**: daily or weekly revenue trend with enough context to see recent performance.
- **Forecast layer**: July 2025 forecast clearly labelled and toggleable, visually distinct from actuals.
- **Restaurant navigation**: switch between all 22 restaurants (and an "All" aggregate view).
- **Financial KPIs**: typical day revenue, forecast month total, weekend vs weekday split, latest trading run-rate. All labelled in ZAR.
- **Audience**: non-technical restaurant managers — no model diagnostics in the main view.

## CSV Validation Checklist

- Exactly 682 rows (no header counted).
- `restaurant_id` covers every integer 1 through 22.
- `date` covers every day 2025-07-01 through 2025-07-31.
- `predicted_revenue` is numeric, non-negative.
- No duplicate `(restaurant_id, date)` pairs.

## Tech Stack

- **Dashboard**: React 19, Vite 8, Recharts 3, PapaParse, date-fns. TypeScript configured but JSX used in practice.
- **Forecast**: Python (pandas, numpy, matplotlib). No specific ML framework chosen yet — model selection is open.
