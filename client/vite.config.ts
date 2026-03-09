// vite.config.ts
//
// Vite configuration. Vite is the build tool and dev server for the frontend.
//
// In development:
//   - Serves files from src/ directly (no bundling — instant startup)
//   - Hot Module Replacement: saves a file → browser updates instantly
//   - Dev server runs at http://localhost:5173
//
// In production (npm run build):
//   - TypeScript → JavaScript (via esbuild, very fast)
//   - Tree shakes unused code
//   - Bundles and minifies everything into dist/

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The React plugin enables:
  //   - JSX transformation (turning <Component /> into React.createElement calls)
  //   - Fast Refresh (HMR that preserves component state when you edit)
  plugins: [react()],

  // Dev server configuration
  server: {
    port: 5173,

    // "proxy" forwards certain requests to our backend server.
    // When the browser makes a request to /api/*, Vite forwards it to localhost:3001.
    //
    // WHY: Without this, the browser would make a request to localhost:5173/api/auth/login,
    // which Vite doesn't know how to handle. The proxy makes API calls "just work"
    // during development without CORS issues.
    proxy: {
      "/api": {
        // Use VITE_SERVER_URL if set (cross-machine testing), otherwise localhost.
        // process.env works here because vite.config.ts runs in Node, not the browser.
        target: process.env.VITE_SERVER_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },

  // Build output goes to dist/
  build: {
    outDir: "dist",
  },
});
