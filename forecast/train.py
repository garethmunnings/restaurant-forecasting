#!/usr/bin/env python
"""
XGBoost training and July 2025 forecast generation (v6).

Key approach:
- Raw ZAR target with reg:absoluteerror (MAE loss) for robustness
- Per-restaurant inverse-median weights to equalise restaurant attention
- July and school-holiday temporal upweighting
- MAPE computed on days with revenue >= 5% of restaurant median (filters noise)
- Optuna optimises for MAPE on July-aligned CV folds
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
TRAIN_START = pd.Timestamp('2023-01-01')

CV_FOLDS = [
    (pd.Timestamp('2023-07-01'), pd.Timestamp('2023-07-01'), pd.Timestamp('2023-07-31')),
    (pd.Timestamp('2024-07-01'), pd.Timestamp('2024-07-01'), pd.Timestamp('2024-07-31')),
    (pd.Timestamp('2025-06-01'), pd.Timestamp('2025-06-01'), pd.Timestamp('2025-06-30')),
]

VALIDATION_START = pd.Timestamp('2024-07-01')
VALIDATION_END = pd.Timestamp('2024-07-31')

DROP_COLS = ['date', 'revenue', 'is_forecast']

SEED = 42
N_OPTUNA_TRIALS = 100

# Minimum revenue threshold for MAPE (days below this are noise)
MAPE_FLOOR_PCT = 0.05  # 5% of restaurant median


# ── 1. DATA LOADING ────────────────────────────────────────────────────────

def load_and_prepare():
    df = pd.read_csv(FEATURES_CSV, parse_dates=['date'])

    hist = df[df['is_forecast'] == False].copy()
    df_forecast = df[df['is_forecast'] == True].copy()
    hist = hist[hist['date'] >= TRAIN_START].copy()

    feature_cols = [c for c in df.columns if c not in DROP_COLS]

    fc_nan = df_forecast[feature_cols].isna().sum()
    fc_nan = fc_nan[fc_nan > 0]
    if len(fc_nan) > 0:
        print("WARNING -- NaN in forecast features:")
        print(fc_nan)

    print(f"[data] Historical: {len(hist):,} rows  "
          f"({hist['date'].min().date()} to {hist['date'].max().date()})")
    print(f"[data] Forecast:   {len(df_forecast):,} rows")
    print(f"[data] Features:   {len(feature_cols)}")

    return hist, df_forecast, feature_cols


# ── SAMPLE WEIGHTS ────────────────────────────────────────────────────────

def compute_sample_weights(df):
    """Combine temporal upweighting with per-restaurant inverse-median scaling."""
    w = np.ones(len(df))

    # Temporal: upweight July and school holidays
    months = df['date'].dt.month.values
    w[months == 7] = 2.0
    if 'is_school_holiday' in df.columns:
        holiday = df['is_school_holiday'].values == 1
        non_july_holiday = holiday & (months != 7)
        w[non_july_holiday] = 1.5

    # Per-restaurant: scale by inverse median so small restaurants get equal attention
    medians = df['restaurant_median_revenue'].values
    # Normalise so weights average ~1 across restaurants
    med_scale = np.where(medians > 0, np.median(medians) / medians, 1.0)
    w *= med_scale

    return w


# ── MAPE COMPUTATION ─────────────────────────────────────────────────────

def compute_mape(y_true, y_pred, restaurant_ids, restaurant_medians):
    """Compute MAPE excluding near-zero days (< 5% of restaurant median)."""
    floors = restaurant_medians * MAPE_FLOOR_PCT
    valid = y_true >= floors
    if valid.sum() == 0:
        return float('nan')
    return np.mean(np.abs((y_true[valid] - y_pred[valid]) / y_true[valid])) * 100


# ── 2. OPTUNA HP SEARCH ─────────────────────────────────────────────────

def find_best_params_cv(df_hist, feature_cols):
    """Bayesian HP search optimising for MAPE."""

    def objective(trial):
        params = {
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.005, 0.1, log=True),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 20),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.4, 1.0),
            'reg_alpha': trial.suggest_float('reg_alpha', 1e-4, 10, log=True),
            'reg_lambda': trial.suggest_float('reg_lambda', 1e-4, 10, log=True),
            'gamma': trial.suggest_float('gamma', 0, 2.0),
        }

        fold_mapes = []
        for train_end, val_start, val_end in CV_FOLDS:
            df_train = df_hist[df_hist['date'] < train_end]
            df_val = df_hist[(df_hist['date'] >= val_start) &
                             (df_hist['date'] <= val_end)]

            X_tr = df_train[feature_cols]
            y_tr = df_train[TARGET].values
            w_tr = compute_sample_weights(df_train)
            X_va = df_val[feature_cols]
            y_va = df_val[TARGET].values

            model = xgb.XGBRegressor(
                objective='reg:absoluteerror',
                tree_method='hist',
                n_estimators=2000,
                early_stopping_rounds=50,
                verbosity=0,
                random_state=SEED,
                **params,
            )
            model.fit(X_tr, y_tr, sample_weight=w_tr,
                      eval_set=[(X_va, y_va)],
                      verbose=False)

            preds = np.clip(model.predict(X_va), 0, None)
            mape = compute_mape(y_va, preds,
                                df_val['restaurant_id'].values,
                                df_val['restaurant_median_revenue'].values)
            if not np.isnan(mape):
                fold_mapes.append(mape)

        return np.mean(fold_mapes) if fold_mapes else 100.0

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction='minimize',
        sampler=optuna.samplers.TPESampler(seed=SEED),
    )

    print(f"\n[tune] Running {N_OPTUNA_TRIALS} Optuna trials "
          f"with {len(CV_FOLDS)}-fold time-series CV (MAE loss, MAPE metric) ...")
    t0 = time.time()
    study.optimize(objective, n_trials=N_OPTUNA_TRIALS)
    elapsed = time.time() - t0

    print(f"[tune] Done in {elapsed:.1f}s")
    print(f"[tune] Best CV MAPE: {study.best_value:.1f}%")
    print(f"[tune] Best params:")
    for k, v in study.best_params.items():
        print(f"    {k}: {v}")

    return study.best_params


# ── 3. FINAL MODEL TRAINING ───────────────────────────────────────────────

def train_final_model(X_train, y_train, X_val, y_val, best_params, w_train=None):
    model = xgb.XGBRegressor(
        objective='reg:absoluteerror',
        tree_method='hist',
        n_estimators=2000,
        early_stopping_rounds=50,
        verbosity=0,
        random_state=SEED,
        **best_params,
    )
    model.fit(X_train, y_train, sample_weight=w_train,
              eval_set=[(X_val, y_val)], verbose=False)

    print(f"\n[model] Best iteration: {model.best_iteration}")
    print(f"[model] Best val score: {model.best_score:,.0f}")
    return model


# ── 4. EVALUATION ─────────────────────────────────────────────────────────

def evaluate(model, X_val, df_val, feature_cols):
    preds = np.clip(model.predict(X_val), 0, None)

    y_val_raw = df_val[TARGET].values
    mae = mean_absolute_error(y_val_raw, preds)
    rmse = np.sqrt(mean_squared_error(y_val_raw, preds))

    # Overall MAPE (with floor filter)
    mape = compute_mape(y_val_raw, preds,
                        df_val['restaurant_id'].values,
                        df_val['restaurant_median_revenue'].values)

    # Also compute raw MAPE for comparison
    nonzero = y_val_raw > 0
    raw_mape = np.mean(np.abs((y_val_raw[nonzero] - preds[nonzero])
                              / y_val_raw[nonzero])) * 100

    print(f"\n{'='*60}")
    print(f"  Validation Metrics (July 2024)")
    print(f"  MAE:        R {mae:,.0f}")
    print(f"  RMSE:       R {rmse:,.0f}")
    print(f"  MAPE:       {mape:.1f}% (excl. near-zero days)")
    print(f"  Raw MAPE:   {raw_mape:.1f}% (all non-zero days)")
    print(f"{'='*60}")

    # Per-restaurant
    val_results = df_val[['restaurant_id', 'revenue', 'restaurant_median_revenue']].copy()
    val_results['predicted'] = preds

    print("\n  Per-restaurant MAPE:")
    for rid in sorted(val_results['restaurant_id'].unique()):
        g = val_results[val_results['restaurant_id'] == rid]
        med = g['restaurant_median_revenue'].iloc[0]
        floor = med * MAPE_FLOOR_PCT

        # MAE
        r_mae = mean_absolute_error(g['revenue'], g['predicted'])

        # Filtered MAPE
        valid = g['revenue'] >= floor
        if valid.sum() > 0:
            r_mape = np.mean(np.abs((g.loc[valid, 'revenue'].values -
                                     g.loc[valid, 'predicted'].values)
                                    / g.loc[valid, 'revenue'].values)) * 100
        else:
            r_mape = float('nan')

        n_filtered = (~valid).sum()
        flag = " WARNING" if r_mape > 25 else ""
        filt = f" ({n_filtered} days filtered)" if n_filtered > 0 else ""
        if np.isnan(r_mape):
            print(f"    R{rid:>2d}: MAE R{r_mae:>8,.0f}  MAPE N/A{filt}")
        else:
            print(f"    R{rid:>2d}: MAE R{r_mae:>8,.0f}  MAPE {r_mape:>5.1f}%{flag}{filt}")

    # Feature importance
    importance = model.get_booster().get_score(importance_type='gain')
    sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    print(f"\n  Top 15 features (by gain):")
    for fname, gain in sorted_imp[:15]:
        print(f"    {fname:<40s} {gain:>12,.0f}")

    metrics = {'mae': mae, 'rmse': rmse, 'mape_filtered': mape, 'mape_raw': raw_mape}
    return metrics


# ── 5. GENERATE FORECAST ──────────────────────────────────────────────────

def generate_forecast(model, df_forecast, feature_cols):
    X = df_forecast[feature_cols]
    preds = np.clip(model.predict(X), 0, None)
    preds = np.round(preds, 2)

    out = pd.DataFrame({
        'restaurant_id': df_forecast['restaurant_id'].values,
        'date': df_forecast['date'].dt.strftime('%Y-%m-%d'),
        'predicted_revenue': preds,
    })

    assert len(out) == 682, f"Expected 682 rows, got {len(out)}"
    assert set(out['restaurant_id']) == set(range(1, 23)), "Missing restaurant_ids"
    assert out['date'].nunique() == 31, "Expected 31 unique dates"
    assert out.duplicated(subset=['restaurant_id', 'date']).sum() == 0, "Duplicates found"
    assert out['predicted_revenue'].isna().sum() == 0, "NaN in predictions"
    assert (out['predicted_revenue'] >= 0).all(), "Negative predictions"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(FORECAST_CSV, index=False)

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
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(str(MODEL_PATH))

    metadata = {
        'model_file': MODEL_PATH.name,
        'features': feature_cols,
        'best_params': best_params,
        'validation_metrics': metrics,
        'best_iteration': best_iter,
        'train_start': str(TRAIN_START.date()),
        'validation_period': f'{VALIDATION_START.date()} to {VALIDATION_END.date()}',
        'target_transform': 'none (raw ZAR)',
        'objective': 'reg:absoluteerror',
        'hp_search': f'optuna_tpe_{N_OPTUNA_TRIALS}_trials_mape_objective',
        'cv_folds': len(CV_FOLDS),
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2))

    print(f"[save] Model  -> {MODEL_PATH}")
    print(f"[save] Meta   -> {METADATA_PATH}")


# ── MAIN ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  XGBoost Revenue Forecast -- July 2025 (v6)")
    print("  MAE loss | Inverse-median weights | July-aligned CV")
    print("=" * 60)

    df_hist, df_forecast, feature_cols = load_and_prepare()

    best_params = find_best_params_cv(df_hist, feature_cols)

    # Eval model: exclude July 2024 from training
    val_mask = (df_hist['date'] >= VALIDATION_START) & (df_hist['date'] <= VALIDATION_END)
    df_val = df_hist[val_mask]
    df_train = df_hist[~val_mask]

    X_train = df_train[feature_cols]
    y_train = df_train[TARGET].values
    w_train = compute_sample_weights(df_train)
    X_val = df_val[feature_cols]
    y_val = df_val[TARGET].values

    eval_model = train_final_model(X_train, y_train, X_val, y_val, best_params, w_train)
    metrics = evaluate(eval_model, X_val, df_val, feature_cols)

    # Retrain on all data for forecast
    retrain_split = pd.Timestamp('2025-06-15')
    df_retrain_train = df_hist[df_hist['date'] < retrain_split]
    df_retrain_val = df_hist[df_hist['date'] >= retrain_split]

    print(f"\n[retrain] Retraining on all historical data "
          f"({len(df_hist):,} rows) with early stopping ...")
    print(f"  Train portion: {len(df_retrain_train):,} rows (up to {retrain_split.date()})")
    print(f"  ES holdout:    {len(df_retrain_val):,} rows (June 15-30)")

    final_model = xgb.XGBRegressor(
        objective='reg:absoluteerror',
        tree_method='hist',
        n_estimators=2000,
        early_stopping_rounds=50,
        verbosity=0,
        random_state=SEED,
        **best_params,
    )
    w_retrain = compute_sample_weights(df_retrain_train)
    final_model.fit(
        df_retrain_train[feature_cols], df_retrain_train[TARGET].values,
        sample_weight=w_retrain,
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
