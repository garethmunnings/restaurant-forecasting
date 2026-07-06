import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves from https://garethmunnings.github.io/restaurant-forecasting/
  base: "/restaurant-forecasting/",
  plugins: [react()],
});
