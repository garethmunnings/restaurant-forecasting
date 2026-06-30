#!/usr/bin/env python
"""
Step 3: Feature engineering for July 2025 daily restaurant revenue forecast.

Reads aggregated_daily_revenue.csv (restaurant_id, date, revenue only) plus
supplementary CSVs, and outputs a single feature matrix for XGBoost.

Output: data/features.csv
"""

import math

import pandas as pd
import numpy as np
from pathlib import Path

# ── CONFIG ──────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
AGG_CSV = DATA_DIR / 'aggregated_daily_revenue.csv'
SALE_CSV = DATA_DIR / 'spur_reporting.student_program.sale.csv'
SALE_CUST_CSV = DATA_DIR / 'spur_reporting.student_program.sale_customer.csv'
RESTAURANT_CSV = DATA_DIR / 'spur_reporting.student_program.restaurant.csv'
HOLIDAY_CSV = DATA_DIR / 'sa_school_holidays.csv'
OUTPUT_CSV = DATA_DIR / 'features.csv'

FORECAST_START = pd.Timestamp('2025-07-01')
FORECAST_END = pd.Timestamp('2025-07-31')

LAG_DAYS = [7, 14, 21, 28, 364, 365, 728]
ROLLING_WINDOWS = [7, 14, 28, 90]

# Map short lags to rolling-mean columns used as fill proxies for forecast rows
SHORT_LAGS = [7, 14, 21, 28]
LAG_TO_ROLLING = {7: 'rolling_7_mean', 14: 'rolling_14_mean',
                  21: 'rolling_28_mean', 28: 'rolling_28_mean'}

PROVINCE_TO_CLUSTER = {
    'Western Cape': 'coastal',
    'KwaZulu-Natal': 'coastal',
    'Gauteng': 'inland',
    'North West': 'inland',
    'Free State': 'inland',
    'Mpumalanga': 'inland',
    'Limpopo': 'inland',
}


# ── 1. BASE DATA ───────────────────────────────────────────────────────────

def load_base_data():
    """Load 3 core columns from aggregated CSV, extend with July 2025 shell rows."""
    df = pd.read_csv(AGG_CSV, usecols=['restaurant_id', 'date', 'revenue'],
                     parse_dates=['date'])
    if df['date'].dt.tz is not None:
        df['date'] = df['date'].dt.tz_localize(None)

    # July 2025 forecast rows (revenue = NaN)
    july_dates = pd.date_range(FORECAST_START, FORECAST_END, freq='D')
    restaurant_ids = sorted(df['restaurant_id'].unique())
    forecast_rows = pd.DataFrame(
        [(rid, d, np.nan) for rid in restaurant_ids for d in july_dates],
        columns=['restaurant_id', 'date', 'revenue'],
    )

    df = pd.concat([df, forecast_rows], ignore_index=True)
    df = df.sort_values(['restaurant_id', 'date']).reset_index(drop=True)
    df['is_forecast'] = df['date'] >= FORECAST_START

    print(f"[1] Base data: {len(df)} rows "
          f"({(~df['is_forecast']).sum()} hist + {df['is_forecast'].sum()} forecast)")
    return df


# ── 2. CALENDAR FEATURES ──────────────────────────────────────────────────

def add_calendar_features(df):
    df['day_of_week'] = df['date'].dt.dayofweek
    df['day_of_month'] = df['date'].dt.day
    df['month'] = df['date'].dt.month
    df['week_of_year'] = df['date'].dt.isocalendar().week.astype(int)
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)

    # Payday: 25th of month
    df['is_payday_25'] = (df['day_of_month'] == 25).astype(int)

    # Last business day of month (common payday for salaried workers)
    bmonth_end = df['date'] + pd.offsets.BMonthEnd(0)
    df['is_month_end_payday'] = (df['date'] == bmonth_end).astype(int)

    # Days since/until month boundaries (spending tends to cluster around paydays)
    df['days_since_25'] = (df['day_of_month'] - 25) % 31  # wraps around
    df['days_into_month'] = df['day_of_month']

    print(f"[2] Calendar features added ({df.shape[1]} cols)")
    return df


# ── 3. HOLIDAY FEATURES ───────────────────────────────────────────────────

def _expand_holiday_ranges(holiday_csv):
    """Expand start_date/end_date ranges into one row per date."""
    hol = pd.read_csv(holiday_csv, parse_dates=['start_date', 'end_date'])
    rows = []
    for _, r in hol.iterrows():
        for d in pd.date_range(r['start_date'], r['end_date'], freq='D'):
            rows.append({
                'date': d,
                'cluster': r['cluster'],
                'type': r['type'],
            })
    return pd.DataFrame(rows)


def add_holiday_features(df):
    restaurants = pd.read_csv(RESTAURANT_CSV)
    province_map = dict(zip(restaurants['restaurant_id'], restaurants['province']))
    df['province'] = df['restaurant_id'].map(province_map)
    df['cluster'] = df['province'].map(PROVINCE_TO_CLUSTER)

    expanded = _expand_holiday_ranges(HOLIDAY_CSV)

    # Public holidays (cluster is always 'all')
    public_dates = set(expanded.loc[expanded['type'] == 'public_holiday', 'date'])
    df['is_public_holiday'] = df['date'].isin(public_dates).astype(int)

    # Adjacent to public holiday (bridge-day effect)
    public_prev = {d - pd.Timedelta(days=1) for d in public_dates}
    public_next = {d + pd.Timedelta(days=1) for d in public_dates}
    df['is_holiday_adjacent'] = (
        df['date'].isin(public_prev | public_next) & ~df['date'].isin(public_dates)
    ).astype(int)

    # School holidays — province-aware for 2023 (inland/coastal), unified for 2024+
    school = expanded[expanded['type'].isin(['school_holiday', 'special_school_holiday'])]
    # Build lookup: {(date, cluster)} set
    school_set = set(zip(school['date'], school['cluster']))

    def _is_school_holiday(row):
        d = row['date']
        c = row['cluster']
        return int((d, c) in school_set or (d, 'all') in school_set)

    df['is_school_holiday'] = df.apply(_is_school_holiday, axis=1)

    # Keep cluster for holiday depth; drop later
    print(f"[3] Holiday features added ({df.shape[1]} cols)")
    return df


# ── 3b. SCHOOL HOLIDAY DEPTH FEATURES ───────────────────────────────────

def _build_holiday_periods(holiday_csv):
    """Build a list of (start, end, cluster) for school holiday periods."""
    hol = pd.read_csv(holiday_csv, parse_dates=['start_date', 'end_date'])
    school = hol[hol['type'].isin(['school_holiday', 'special_school_holiday'])]
    periods = []
    for _, r in school.iterrows():
        periods.append((r['start_date'], r['end_date'], r['cluster']))
    return periods


def add_holiday_depth_features(df):
    """Add depth features for school holiday periods (vectorized)."""
    periods = _build_holiday_periods(HOLIDAY_CSV)

    df['days_into_school_holiday'] = 0
    df['days_until_holiday_end'] = 0
    df['holiday_week_number'] = 0

    # Vectorized: loop over periods (small list), mask rows
    for start, end, cluster in periods:
        if cluster == 'all':
            mask = (df['date'] >= start) & (df['date'] <= end)
        else:
            mask = (df['date'] >= start) & (df['date'] <= end) & (df['cluster'] == cluster)
        # Only update rows not already assigned (first matching period wins)
        unset = df['days_into_school_holiday'] == 0
        active = mask & unset
        if active.any():
            days_in = (df.loc[active, 'date'] - start).dt.days + 1
            df.loc[active, 'days_into_school_holiday'] = days_in
            df.loc[active, 'days_until_holiday_end'] = (end - df.loc[active, 'date']).dt.days
            df.loc[active, 'holiday_week_number'] = np.ceil(days_in / 7).astype(int)

    # Back-to-school week: first 5 weekdays after each holiday period ends
    back_to_school_dates = set()
    for start, end, cluster in periods:
        d = end + pd.Timedelta(days=1)
        count = 0
        while count < 5:
            if d.weekday() < 5:  # Mon-Fri
                back_to_school_dates.add((d, cluster))
                count += 1
            d += pd.Timedelta(days=1)

    # Vectorized back-to-school check
    bts_all = {d for d, c in back_to_school_dates if c == 'all'}
    bts_cluster = {}
    for d, c in back_to_school_dates:
        if c != 'all':
            bts_cluster.setdefault(c, set()).add(d)

    df['is_back_to_school_week'] = df['date'].isin(bts_all).astype(int)
    for clust, dates in bts_cluster.items():
        mask = (df['cluster'] == clust) & df['date'].isin(dates)
        df.loc[mask, 'is_back_to_school_week'] = 1

    # Interaction features
    df['school_holiday_x_weekend'] = df['is_school_holiday'] * df['is_weekend']
    df['school_holiday_x_dow'] = df['is_school_holiday'] * df['day_of_week']

    # Winter indicator
    df['is_winter'] = df['month'].isin([6, 7, 8]).astype(int)

    # Drop cluster helper column now
    df.drop(columns=['cluster'], inplace=True)

    print(f"[3b] Holiday depth features added ({df.shape[1]} cols)")
    return df


# ── 4. LAG FEATURES ───────────────────────────────────────────────────────

def add_lag_features(df):
    """Revenue lags per restaurant. NaN where history is too short or in forecast."""
    for lag in LAG_DAYS:
        df[f'lag_{lag}'] = df.groupby('restaurant_id')['revenue'].shift(lag)
    print(f"[4] Lag features added: {[f'lag_{l}' for l in LAG_DAYS]}")
    return df


# ── 5. ROLLING FEATURES ───────────────────────────────────────────────────

def add_rolling_features(df):
    """Rolling mean/std of revenue with shift(1) to prevent same-day leakage.

    For forecast rows where the window overlaps NaN July revenue, values are
    forward-filled from the last valid computation (June 30).
    """
    for w in ROLLING_WINDOWS:
        # Mean
        df[f'rolling_{w}_mean'] = df.groupby('restaurant_id')['revenue'].transform(
            lambda s: s.shift(1).rolling(w, min_periods=1).mean().ffill()
        )

    # Std for 7-day and 28-day windows only (diminishing returns for wider)
    for w in [7, 28]:
        df[f'rolling_{w}_std'] = df.groupby('restaurant_id')['revenue'].transform(
            lambda s: s.shift(1).rolling(w, min_periods=2).std().ffill()
        )

    print(f"[5] Rolling features added ({df.shape[1]} cols)")
    return df


# ── 5b. FILL SHORT-LAG NaNs ON FORECAST ROWS ────────────────────────────

def fill_forecast_lags(df):
    """Fill short-lag NaNs on forecast rows with cascade: prefer actual lags over rolling proxies."""
    mask = df['is_forecast']
    # Cascade: for each short lag, try longer lags first, then rolling mean
    lag_cascade = {
        7:  ['lag_14', 'lag_21', 'lag_28', 'rolling_7_mean'],
        14: ['lag_21', 'lag_28', 'rolling_14_mean'],
        21: ['lag_28', 'rolling_28_mean'],
        28: ['rolling_28_mean'],
    }
    for lag, fallbacks in lag_cascade.items():
        col = f'lag_{lag}'
        for fb in fallbacks:
            still_nan = mask & df[col].isna()
            if still_nan.any() and fb in df.columns:
                df.loc[still_nan, col] = df.loc[still_nan, fb]
    n_still_nan = df.loc[mask, [f'lag_{l}' for l in SHORT_LAGS]].isna().sum().sum()
    print(f"[5b] Forecast short-lag NaNs filled (remaining NaN: {n_still_nan})")
    return df


# ── 6. SAME-WEEK-LAST-YEAR AVERAGE ────────────────────────────────────────

def add_same_week_last_year(df):
    """Mean revenue for the 7-day window 361-367 days ago (same weekday ±3 days)."""
    df['same_week_ly_avg'] = df.groupby('restaurant_id')['revenue'].transform(
        lambda s: s.shift(361).rolling(7, min_periods=3).mean()
    )
    print(f"[6] same_week_ly_avg added ({df.shape[1]} cols)")
    return df


# ── 7. TRANSACTION COUNTS & VOUCHER SIGNALS ───────────────────────────────

def add_transaction_and_voucher_features(df):
    """Daily bill count, unique customer count, and voucher metrics.

    Computed from sale.csv and sale_customer.csv, then merged and rolling-averaged.
    """
    # Load sale.csv once for both transaction counts and voucher signals
    sales = pd.read_csv(
        SALE_CSV,
        usecols=['sale_id', 'restaurant_id', 'sale_at',
                 'had_voucher', 'voucher_redeemer_count'],
        parse_dates=['sale_at'], date_format='ISO8601',
    )
    if sales['sale_at'].dt.tz is not None:
        sales['sale_at'] = sales['sale_at'].dt.tz_localize(None)
    sales['date'] = sales['sale_at'].dt.normalize()

    # ── Bill count + voucher aggregates (from sale.csv directly) ──
    daily_sale = sales.groupby(['restaurant_id', 'date']).agg(
        bill_count=('sale_id', 'count'),
        voucher_bills=('had_voucher', 'sum'),
        voucher_redeemers=('voucher_redeemer_count', 'sum'),
    ).reset_index()

    # ── Unique customer count (from sale_customer joined to sale for dates) ──
    sale_cust = pd.read_csv(SALE_CUST_CSV, usecols=['sale_id', 'customer_id'])
    sale_cust = sale_cust.merge(
        sales[['sale_id', 'restaurant_id', 'date']], on='sale_id', how='inner'
    )
    daily_cust = sale_cust.groupby(['restaurant_id', 'date']).agg(
        unique_customers=('customer_id', 'nunique'),
    ).reset_index()

    # Merge onto main dataframe
    df = df.merge(daily_sale, on=['restaurant_id', 'date'], how='left')
    df = df.merge(daily_cust, on=['restaurant_id', 'date'], how='left')

    # Compute rolling averages (shift(1) + ffill for forecast rows)
    extra_cols = ['bill_count', 'unique_customers', 'voucher_bills', 'voucher_redeemers']
    for col in extra_cols:
        for w in [7, 28]:
            df[f'rolling_{w}_{col}_mean'] = df.groupby('restaurant_id')[col].transform(
                lambda s: s.shift(1).rolling(w, min_periods=1).mean().ffill()
            )

    # Drop raw daily values (NaN for July; rolling averages carry the signal forward)
    df.drop(columns=extra_cols, inplace=True)

    print(f"[7] Transaction & voucher features added ({df.shape[1]} cols)")
    return df


# ── 8. ORDINAL ENCODING (province + restaurant) ─────────────────────────

PROVINCE_LABELS = {
    'Free State': 0, 'Gauteng': 1, 'KwaZulu-Natal': 2,
    'Limpopo': 3, 'Mpumalanga': 4, 'North West': 5, 'Western Cape': 6,
}

def add_ordinal_encoding(df):
    """Label-encode province as integer; restaurant_id is already integer."""
    df['province_code'] = df['province'].map(PROVINCE_LABELS)
    df.drop(columns=['province'], inplace=True)
    print(f"[8] Ordinal encoding added ({df.shape[1]} cols)")
    return df


# ── 9. RESTAURANT-LEVEL SCALE FEATURE ─────────────────────────────────────

def add_restaurant_scale(df):
    """Median daily revenue per restaurant (static feature capturing outlet size).

    Computed from historical data only to avoid leakage.
    """
    hist = df.loc[~df['is_forecast'], ['restaurant_id', 'revenue']]
    medians = hist.groupby('restaurant_id')['revenue'].median().rename('restaurant_median_revenue')
    df = df.merge(medians, on='restaurant_id', how='left')

    print(f"[9] Restaurant scale feature added ({df.shape[1]} cols)")
    return df


# ── 10. YEAR-OVER-YEAR GROWTH RATE ──────────────────────────────────────

def add_yoy_growth(df):
    """Trailing 28-day revenue ratio vs same window one year ago."""
    def _yoy(s):
        recent = s.shift(1).rolling(28, min_periods=14).mean()
        year_ago = s.shift(365).rolling(28, min_periods=14).mean()
        ratio = recent / year_ago.replace(0, np.nan)
        return ratio.ffill().fillna(1.0)

    df['yoy_growth_rate'] = df.groupby('restaurant_id')['revenue'].transform(_yoy)
    print(f"[10] YoY growth rate added ({df.shape[1]} cols)")
    return df


# ── MAIN ───────────────────────────────────────────────────────────────────

def main():
    df = load_base_data()
    df = add_calendar_features(df)
    df = add_holiday_features(df)
    df = add_holiday_depth_features(df)
    df = add_lag_features(df)
    df = add_rolling_features(df)
    df = fill_forecast_lags(df)
    df = add_same_week_last_year(df)
    df = add_transaction_and_voucher_features(df)
    df = add_ordinal_encoding(df)
    df = add_restaurant_scale(df)
    df = add_yoy_growth(df)

    # Final sort and save
    df = df.sort_values(['restaurant_id', 'date']).reset_index(drop=True)
    df.to_csv(OUTPUT_CSV, index=False)

    # Summary
    n_features = df.shape[1] - 3  # exclude restaurant_id, date, revenue
    forecast_rows = df[df['is_forecast']]
    print(f"\n{'='*60}")
    print(f"Saved {OUTPUT_CSV}")
    print(f"  Total rows:     {len(df):,}")
    print(f"  Forecast rows:  {len(forecast_rows):,}")
    print(f"  Feature count:  {n_features}")
    print(f"  Columns: {df.columns.tolist()}")

    # Report NaN coverage in forecast rows for key features
    print(f"\n  NaN in forecast rows (key features):")
    for col in [c for c in df.columns if c.startswith('lag_') or c.startswith('rolling_')]:
        n_nan = forecast_rows[col].isna().sum()
        if n_nan > 0:
            print(f"    {col}: {n_nan}/{len(forecast_rows)} NaN")


if __name__ == '__main__':
    main()
