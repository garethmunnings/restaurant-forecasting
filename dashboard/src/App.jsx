import { useState, useMemo } from "react";
import useSalesData from "./hooks/useSalesData.js";
import {
  buildChartData,
  computeKpis,
  computeRanking,
  generateSummary,
} from "./utils/dataHelpers.js";
import Header from "./components/Header.jsx";
import Controls from "./components/Controls.jsx";
import SalesChart from "./components/SalesChart.jsx";
import RevenueTotal from "./components/RevenueTotal.jsx";
import KpiGroup from "./components/KpiGroup.jsx";
import RestaurantRanking from "./components/RestaurantRanking.jsx";
import { Loading, ErrorCard, EmptyState } from "./components/LoadingState.jsx";

export default function App() {
  const { data, loading, error, retry } = useSalesData();
  const [selectedRestaurant, setSelectedRestaurant] = useState("all");
  const [showForecast, setShowForecast] = useState(false);
  const [showHolidays, setShowHolidays] = useState(true);
  const [dateRange, setDateRange] = useState("6m");

  const chartData = useMemo(
    () =>
      data
        ? buildChartData(
            data.dailySales,
            data.forecast,
            selectedRestaurant,
            showForecast,
            dateRange,
            data.holidays
          )
        : [],
    [data, selectedRestaurant, showForecast, dateRange]
  );

  const kpis = useMemo(
    () =>
      data
        ? computeKpis(
            data.dailySales,
            data.forecast,
            selectedRestaurant,
            showForecast
          )
        : null,
    [data, selectedRestaurant, showForecast]
  );

  const ranking = useMemo(
    () =>
      data
        ? computeRanking(
            data.dailySales,
            data.forecast,
            data.restaurants,
            showForecast,
            dateRange
          )
        : null,
    [data, showForecast, dateRange]
  );

  const summary = useMemo(
    () =>
      data
        ? generateSummary(
            data.dailySales,
            data.forecast,
            selectedRestaurant,
            showForecast,
            dateRange
          )
        : null,
    [data, selectedRestaurant, showForecast, dateRange]
  );

  if (loading) {
    return (
      <div className="app">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <ErrorCard message={error} onRetry={retry} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="app">
      <Header />
      <div className="main-layout">
        <div className="main-left">
          <RevenueTotal kpis={kpis} summary={summary} />
          <Controls
            restaurants={data.restaurants}
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={setSelectedRestaurant}
            showForecast={showForecast}
            onToggleForecast={() => setShowForecast((prev) => !prev)}
            forecast={data.forecast}
          />
          <SalesChart
            data={chartData}
            showForecast={showForecast}
            showHolidays={showHolidays}
            onToggleHolidays={() => setShowHolidays((prev) => !prev)}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />
        </div>
        <RestaurantRanking
          ranking={ranking}
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={setSelectedRestaurant}
          showForecast={showForecast}
        />
      </div>
      <KpiGroup kpis={kpis} />
    </div>
  );
}
