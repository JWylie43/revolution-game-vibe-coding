// src/main.tsx
//
// The React entry point. This is the first file that runs.
// It mounts the React app into the <div id="root"> in index.html.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";   // Global CSS (Tailwind base styles)

// ReactDOM.createRoot creates a "root" — the container for the entire React app.
// document.getElementById("root") finds our <div id="root"> in index.html.
// .render(<App />) tells React to render the App component inside it.
//
// <React.StrictMode> is a development helper that:
//   - Warns about deprecated patterns
//   - Runs render functions twice to detect side effects (dev only, not production)
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
