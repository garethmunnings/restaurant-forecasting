import pandas as pd
import matplotlib.pyplot as plt

# Load sale data only
sales = pd.read_csv('../data/spur_reporting.student_program.sale.csv')

# Parse the sale timestamp and filter to restaurant 8, June 2025 only
sales['sale_at'] = pd.to_datetime(sales['sale_at'], utc=True)
mask = (
    (sales['restaurant_id'] == 8)
    & (sales['sale_at'].dt.year == 2025)
    & (sales['sale_at'].dt.month == 6)
)
r8 = sales.loc[mask].sort_values('sale_at')

print("=" * 50)
print("SALES (restaurant 8, June 2025)")
print("=" * 50)
print(r8.head(10))
print(f"Shape: {r8.shape}")
print(f"Date range: {r8['sale_at'].min()} to {r8['sale_at'].max()}")
print(f"Total bills: {len(r8):,}")
print(f"Total revenue: R{r8['amount'].sum():,.2f}")
print(f"Amount range: R{r8['amount'].min():,.2f} to R{r8['amount'].max():,.2f}")
print(f"Avg bill: R{r8['amount'].mean():,.2f}")
print(f"Total participants: {r8['participant_count'].sum():,}")

print("\n" + "=" * 50)
print("DAILY BREAKDOWN")
print("=" * 50)
daily = r8.groupby(r8['sale_at'].dt.date).agg(
    bills=('sale_id', 'count'),
    revenue=('amount', 'sum'),
)
print(daily)

# Quick chart of daily revenue
daily['revenue'].plot(kind='bar', figsize=(12, 5), title='Restaurant 8 - Daily Revenue, June 2025')
plt.ylabel('Revenue (R)')
plt.tight_layout()
plt.savefig('restaurant_8_june_2025.png')
print("\nSaved chart to restaurant_8_june_2025.png")
