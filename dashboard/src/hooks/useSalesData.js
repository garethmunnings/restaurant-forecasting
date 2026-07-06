import { useState, useEffect } from "react";

export default function useSalesData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`${import.meta.env.BASE_URL}sales_data.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (
          !json.restaurants ||
          !json.dailySales ||
          Object.keys(json.dailySales).length === 0
        ) {
          setData(null);
        } else {
          setData(json);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return { data, loading, error, retry: load };
}
