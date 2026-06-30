import pandas as pd
import numpy as np

# ── STEP 2A: Load and inspect ────────────────────────────────────────────────
DATE_COL = 'sale_at'

sales = pd.read_csv(
    '../data/spur_reporting.student_program.sale.csv',
    usecols=['restaurant_id', DATE_COL, 'amount'],
    parse_dates=[DATE_COL],
    date_format='ISO8601',
)
restaurants = pd.read_csv('../data/spur_reporting.student_program.restaurant.csv')

print(f"Raw sales shape: {sales.shape}")
print(f"Sample date values: {sales[DATE_COL].head(5).tolist()}")

# ── STEP 2B: Parse dates correctly ──────────────────────────────────────────
# .dt.normalize() floors timestamps to midnight in a single vectorised call
sales['sale_date'] = sales[DATE_COL].dt.normalize()

print(f"\nDate range: {sales['sale_date'].min()} to {sales['sale_date'].max()}")
print(f"Total days in dataset: {(sales['sale_date'].max() - sales['sale_date'].min()).days}")

# ── STEP 2C: Aggregate to daily revenue per restaurant ───────────────────────
# SUM(amount) per restaurant per calendar day
# This is the ONLY table you sum revenue from
daily = (
    sales
    .groupby(['restaurant_id', 'sale_date'])['amount']
    .sum()
    .reset_index()
    .rename(columns={'amount': 'revenue', 'sale_date': 'date'})
)

print(f"\nDaily aggregate shape: {daily.shape}")
print(daily.head(10))

# ── STEP 2D: Fill in zero-revenue days ──────────────────────────────────────
# Critical: if a restaurant had zero sales on a Tuesday, that row simply
# won't exist in the data. But the model needs to see it as R0, not as
# "missing data". Missing rows distort lag calculations badly.

all_dates = pd.date_range(
    start=daily['date'].min(),
    end=daily['date'].max(),
    freq='D'
)
all_restaurants = daily['restaurant_id'].unique()

# Create a complete grid: every restaurant × every date
complete_index = pd.MultiIndex.from_product(
    [all_restaurants, all_dates],
    names=['restaurant_id', 'date']
)
complete_df = pd.DataFrame(index=complete_index).reset_index()

# Merge actual revenue onto the complete grid; missing days become NaN, then 0
daily_complete = complete_df.merge(daily, on=['restaurant_id', 'date'], how='left')
daily_complete['revenue'] = daily_complete['revenue'].fillna(0)

print(f"\nBefore zero-fill: {daily.shape[0]} rows")
print(f"After zero-fill: {daily_complete.shape[0]} rows")
print(f"Zero-revenue days added: {daily_complete.shape[0] - daily.shape[0]}")

# ── STEP 2E: Attach restaurant metadata ─────────────────────────────────────
daily_complete = daily_complete.merge(restaurants, on='restaurant_id', how='left')

print(f"\nFinal daily dataset columns: {daily_complete.columns.tolist()}")
print(daily_complete.head())

# Quick sanity check: revenue by day of week (should show weekend spike)
daily_complete['day_of_week'] = daily_complete['date'].dt.dayofweek
dow_avg = daily_complete.groupby('day_of_week')['revenue'].mean()
print("\nAverage revenue by day of week (0=Mon, 6=Sun):")
print(dow_avg.round(0))

# Save
daily_complete['revenue'] = daily_complete['revenue'].round(2)
daily_complete.to_csv('../data/aggregated_daily_revenue.csv', index=False)
print("\n[OK] Saved ../data/aggregated_daily_revenue.csv")