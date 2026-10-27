import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* variables from the repo-root .env
  envDir: "..",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
