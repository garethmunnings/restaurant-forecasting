export default function PageHeading({ selectedRestaurant, restaurants, showForecast }) {
  let name = "All Restaurants";
  if (selectedRestaurant !== "all") {
    const r = restaurants.find((r) => String(r.id) === selectedRestaurant);
    name = r ? `Restaurant ${r.id} \u2014 ${r.province}` : `Restaurant ${selectedRestaurant}`;
  }

  const period = showForecast ? "July 2025 Forecast" : "June 2025 Actuals";

  return (
    <h1 className="page-heading">
      {name} <span className="page-heading-period">| {period}</span>
    </h1>
  );
}
