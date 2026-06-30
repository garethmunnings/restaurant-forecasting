export function Loading() {
  return (
    <div className="loading-container">
      <div className="spinner" />
      <p className="loading-text">Loading sales data...</p>
    </div>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="error-card">
      <h3>Unable to load data</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="retry-button" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="empty-state">
      <h3>No sales data available</h3>
      <p>
        Run the preprocessing script to generate the data file:
      </p>
      <code>node scripts/preprocess.mjs</code>
    </div>
  );
}
