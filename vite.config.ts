import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  // GitHub project Pages is served from /<repo>/, not the site root.
  base: process.env.GITHUB_PAGES === "true" ? "/berrify/" : "/",
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
