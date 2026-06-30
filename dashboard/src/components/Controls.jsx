import { generateForecastCsv } from "../utils/dataHelpers.js";

export default function Controls({
  restaurants,
  selectedRestaurant,
  onSelectRestaurant,
  showForecast,
  onToggleForecast,
  forecast,
}) {
  function handleDownload() {
    const csv = generateForecastCsv(forecast);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "july_forecast.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="controls">
      <select
        className="restaurant-select"
        value={selectedRestaurant}
        onChange={(e) => onSelectRestaurant(e.target.value)}
      >
        <option value="all">All Restaurants</option>
        {restaurants.map((r) => (
          <option key={r.id} value={String(r.id)}>
            Restaurant {r.id} — {r.province}
          </option>
        ))}
      </select>
      <label className="forecast-switch">
        <input
          type="checkbox"
          checked={showForecast}
          onChange={onToggleForecast}
        />
        <span className="forecast-switch-track">
          <span className="forecast-switch-knob" />
        </span>
        Show Forecast
      </label>
      {showForecast && (
        <button className="download-btn" onClick={handleDownload}>
          Download Forecast CSV
        </button>
      )}
    </div>
  );
}
