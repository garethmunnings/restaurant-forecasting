#!/usr/bin/env python
"""
XGBoost training and July 2025 forecast generation (v3).

Reads data/features.csv (produced by features.py), tunes hyperparameters via
Optuna with 3-fold time-series CV, trains a global XGBoost model across all
22 restaurants, evaluates on a June 2025 holdout, and writes
forecast/output/july_forecast.csv (682 rows).

Trains on raw ZAR revenue (no log transform). Final model uses early stopping
with a held-out slice rather than a hardcoded tree count.
"""

import json
import time
from pathlib import Path

import numpy as np
import optuna
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

# ── CONFIG ──────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
OUTPUT_DIR = Path(__file__).resolve().parent / 'output'
FEATURES_CSV = DATA_DIR / 'features.csv'
FORECAST_CSV = OUTPUT_DIR / 'july_forecast.csv'
MODEL_PATH = OUTPUT_DIR / 'xgboost_model.json'
METADATA_PATH = OUTPUT_DIR / 'model_metadata.json'

TARGET = 'revenue'
TRAIN_START = pd.Timestamp('2024-01-01')

# Time-series CV folds: (train_end_exclusive, val_start, val_end_inclusive)
CV_FOLDS = [
    (pd.Timestamp('2025-04-01'), pd.Timestamp('2025-04-01'), pd.Timestamp('2025-04-30')),
    (pd.Timestamp('2025-05-01'), pd.Timestamp('2025-05-01'), pd.Timestamp('2025-05-31')),
    (pd.Timestamp('2025-06-01'), pd.Timestamp('2025-06-01'), pd.Timestamp('2025-06-30')),
]

# Final evaluation holdout
VALIDATION_CUTOFF = pd.Timestamp('2025-06-01')

# Columns to exclude from feature matrix
DROP_COLS = ['restaurant_id', 'date', 'revenue', 'is_forecast']

SEED = 42
N_OPTUNA_TRIALS = 60


# ── 1. DATA LOADING ────────────────────────────────────────────────────────

def load_and_prepare():
    """Load features.csv and return historical data, forecast data, and feature cols."""
    df = pd.read_csv(FEATURES_CSV, parse_dates=['date'])

    hist = df[df['is_forecast'] == False].copy()
    df_forecast = df[df['is_forecast'] == True].copy()

    # Only use history from TRAIN_START onward
    hist = hist[hist['date'] >= TRAIN_START].copy()

    feature_cols = [c for c in df.columns if c not in DROP_COLS]

    # Sanity: no NaN in forecast features
    fc_nan = df_forecast[feature_cols].isna().sum()
    fc_nan = fc_nan[fc_nan > 0]
    if len(fc_nan) > 0:
        print("WARNING — NaN in forecast features:")
        print(fc_nan)

    print(f"[data] Historical: {len(hist):,} rows  "
          f"({hist['date'].min().date()} to {hist['date'].max().date()})")
    print(f"[data] Forecast:   {len(df_forecast):,} rows")
    print(f"[data] Features:   {len(feature_cols)}")

    return hist, df_forecast, feature_cols


# ── 2. OPTUNA HYPERPARAMETER SEARCH WITH TIME-SERIES CV ──────────────────

def find_best_params_cv(df_hist, feature_cols):
    """Bayesian HP search with 3-fold expanding-window time-series CV."""

    def objective(trial):
        params = {
            'max_depth': trial.suggest_int('max_depth', 3, 8),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.08, log=True),
            'min_child_weight': trial.suggest_int('min_child_weight', 3, 20),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.5, 1.0),
            'reg_alpha': trial.suggest_float('reg_alpha', 1e-3, 10, log=True),
            'reg_lambda': trial.suggest_float('reg_lambda', 1e-3, 10, log=True),
            'gamma': trial.suggest_float('gamma', 0, 1.0),
        }

        fold_maes = []
        for train_end, val_start, val_end in CV_FOLDS:
            df_train = df_hist[df_hist['date'] < train_end]
            df_val = df_hist[(df_hist['date'] >= val_start) &
                             (df_hist['date'] <= val_end)]

            X_tr = df_train[feature_cols]
            y_tr = df_train[TARGET].values
            X_va = df_val[feature_cols]
            y_va_raw = df_val[TARGET].values

            model = xgb.XGBRegressor(
                objective='reg:squarederror',
                tree_method='hist',
                n_estimators=2000,
                early_stopping_rounds=50,
                verbosity=0,
                random_state=SEED,
                **params,
            )
            model.fit(X_tr, y_tr, eval_set=[(X_va, y_va_raw)],
                      verbose=False)

            preds = np.clip(model.predict(X_va), 0, None)
            fold_maes.append(mean_absolute_error(y_va_raw, preds))

        return np.mean(fold_maes)

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction='minimize',
        sampler=optuna.samplers.TPESampler(seed=SEED),
    )

    print(f"\n[tune] Running {N_OPTUNA_TRIALS} Optuna trials "
          f"with {len(CV_FOLDS)}-fold time-series CV ...")
    t0 = time.time()
    study.optimize(objective, n_trials=N_OPTUNA_TRIALS)
    elapsed = time.time() - t0

    print(f"[tune] Done in {elapsed:.1f}s")
    print(f"[tune] Best CV MAE: R {study.best_value:,.0f}")
    print(f"[tune] Best params:")
    for k, v in study.best_params.items():
        print(f"    {k}: {v}")

    return study.best_params


# ── 3. FINAL MODEL TRAINING ───────────────────────────────────────────────

def train_final_model(X_train, y_train, X_val, y_val, best_params):
    """Train the final model with best hyperparameters on raw ZAR revenue."""
    model = xgb.XGBRegressor(
        objective='reg:squarederror',
        tree_method='hist',
        n_estimators=2000,
        early_stopping_rounds=50,
        verbosity=0,
        random_state=SEED,
        **best_params,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_val, y_val)], verbose=False)

    print(f"\n[model] Best iteration: {model.best_iteration}")
    print(f"[model] Best val score (RMSE): {model.best_score:,.0f}")
    return model


# ── 4. EVALUATION ─────────────────────────────────────────────────────────

def evaluate(model, X_val, y_val_raw, df_val, feature_cols):
    """Compute metrics on ZAR scale."""
    preds = np.clip(model.predict(X_val), 0, None)

    mae = mean_absolute_error(y_val_raw, preds)
    rmse = np.sqrt(mean_squared_error(y_val_raw, preds))

    # MAPE on non-zero days only
    nonzero = y_val_raw > 0
    mape = np.mean(np.abs((y_val_raw[nonzero] - preds[nonzero]) / y_val_raw[nonzero])) * 100

    print(f"\n{'='*60}")
    print(f"  Validation Metrics (June 2025)")
    print(f"  MAE:   R {mae:,.0f}")
    print(f"  RMSE:  R {rmse:,.0f}")
    print(f"  MAPE:  {mape:.1f}% (non-zero days)")
    print(f"{'='*60}")

    # Per-restaurant
    val_results = df_val[['restaurant_id', 'revenue']].copy()
    val_results['predicted'] = preds
    per_rest = val_results.groupby('restaurant_id').apply(
        lambda g: pd.Series({
            'mae': mean_absolute_error(g['revenue'], g['predicted']),
            'median_rev': g['revenue'].median(),
        })
    )
    per_rest['mae_pct'] = np.where(
        per_rest['median_rev'] > 0,
        per_rest['mae'] / per_rest['median_rev'] * 100,
        np.nan,
    )

    print("\n  Per-restaurant MAE:")
    for rid, row in per_rest.iterrows():
        if np.isnan(row['mae_pct']):
            print(f"    R{rid:>2d}:  MAE R {row['mae']:>8,.0f}  "
                  f"(median=0, pct N/A)")
        else:
            flag = " WARNING" if row['mae_pct'] > 30 else ""
            print(f"    R{rid:>2d}:  MAE R {row['mae']:>8,.0f}  "
                  f"({row['mae_pct']:>5.1f}% of median){flag}")

    # Feature importance (top 15 by gain)
    importance = model.get_booster().get_score(importance_type='gain')
    sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    print(f"\n  Top 15 features (by gain):")
    for fname, gain in sorted_imp[:15]:
        print(f"    {fname:<40s} {gain:>12,.0f}")

    metrics = {'mae': mae, 'rmse': rmse, 'mape_nonzero': mape}
    return metrics


# ── 5. GENERATE FORECAST ──────────────────────────────────────────────────

def generate_forecast(model, df_forecast, feature_cols):
    """Predict July 2025 and validate output."""
    X = df_forecast[feature_cols]
    preds = np.clip(model.predict(X), 0, None)
    preds = np.round(preds, 2)

    out = pd.DataFrame({
        'restaurant_id': df_forecast['restaurant_id'].values,
        'date': df_forecast['date'].dt.strftime('%Y-%m-%d'),
        'predicted_revenue': preds,
    })

    # ── Validation ──
    assert len(out) == 682, f"Expected 682 rows, got {len(out)}"
    assert set(out['restaurant_id']) == set(range(1, 23)), "Missing restaurant_ids"
    assert out['date'].nunique() == 31, "Expected 31 unique dates"
    assert out.duplicated(subset=['restaurant_id', 'date']).sum() == 0, "Duplicates found"
    assert out['predicted_revenue'].isna().sum() == 0, "NaN in predictions"
    assert (out['predicted_revenue'] >= 0).all(), "Negative predictions"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(FORECAST_CSV, index=False)

    # Summary
    total = out['predicted_revenue'].sum()
    daily_avg = out['predicted_revenue'].mean()
    print(f"\n[forecast] Saved {FORECAST_CSV}")
    print(f"  Total July revenue:  R {total:,.0f}")
    print(f"  Daily avg (all):     R {daily_avg:,.0f}")
    print(f"  Rows: {len(out)}  |  Restaurants: {out['restaurant_id'].nunique()}  "
          f"|  Days: {out['date'].nunique()}")

    return out


# ── 6. SAVE ARTIFACTS ─────────────────────────────────────────────────────

def save_artifacts(model, metrics, best_params, feature_cols, best_iter):
    """Save model and metadata."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))

    metadata = {
        'model_file': MODEL_PATH.name,
        'features': feature_cols,
        'best_params': best_params,
        'validation_metrics': metrics,
        'best_iteration': best_iter,
        'train_start': str(TRAIN_START.date()),
        'validation_cutoff': str(VALIDATION_CUTOFF.date()),
        'target_transform': 'none (raw ZAR)',
        'hp_search': f'optuna_tpe_{N_OPTUNA_TRIALS}_trials',
        'cv_folds': len(CV_FOLDS),
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2))

    print(f"[save] Model  -> {MODEL_PATH}")
    print(f"[save] Meta   -> {METADATA_PATH}")


# ── MAIN ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  XGBoost Revenue Forecast — July 2025 (v3)")
    print("  Raw ZAR target | Optuna | 3-fold TS-CV")
    print("=" * 60)

    df_hist, df_forecast, feature_cols = load_and_prepare()

    # ── HP search with time-series CV ──
    best_params = find_best_params_cv(df_hist, feature_cols)

    # ── Train on Jan 2024 – May 2025, validate on June 2025 for metrics ──
    df_train = df_hist[df_hist['date'] < VALIDATION_CUTOFF]
    df_val = df_hist[df_hist['date'] >= VALIDATION_CUTOFF]

    X_train = df_train[feature_cols]
    y_train = df_train[TARGET].values
    X_val = df_val[feature_cols]
    y_val = df_val[TARGET].values

    eval_model = train_final_model(X_train, y_train, X_val, y_val, best_params)
    metrics = evaluate(eval_model, X_val, y_val, df_val, feature_cols)
    best_iter = eval_model.best_iteration

    # ── Retrain on ALL historical data for July forecast ──
    # Use last 2 weeks of June as early-stopping holdout to find the right
    # tree count for the larger dataset, instead of hardcoding best_iter.
    retrain_split = pd.Timestamp('2025-06-15')
    df_retrain_train = df_hist[df_hist['date'] < retrain_split]
    df_retrain_val = df_hist[df_hist['date'] >= retrain_split]

    print(f"\n[retrain] Retraining on all historical data "
          f"({len(df_hist):,} rows) with early stopping ...")
    print(f"  Train portion: {len(df_retrain_train):,} rows (up to {retrain_split.date()})")
    print(f"  ES holdout:    {len(df_retrain_val):,} rows (June 15-30)")

    final_model = xgb.XGBRegressor(
        objective='reg:squarederror',
        tree_method='hist',
        n_estimators=2000,
        early_stopping_rounds=50,
        verbosity=0,
        random_state=SEED,
        **best_params,
    )
    final_model.fit(
        df_retrain_train[feature_cols], df_retrain_train[TARGET].values,
        eval_set=[(df_retrain_val[feature_cols], df_retrain_val[TARGET].values)],
        verbose=False,
    )
    print(f"  Final best iteration: {final_model.best_iteration}")

    generate_forecast(final_model, df_forecast, feature_cols)
    save_artifacts(final_model, metrics, best_params, feature_cols,
                   final_model.best_iteration)

    print("\nDone.")


if __name__ == '__main__':
    main()
