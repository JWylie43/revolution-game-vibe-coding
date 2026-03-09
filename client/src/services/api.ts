// services/api.ts
//
// Axios HTTP client configured for our backend.
//
// ── What is Axios? ────────────────────────────────────────────────────────────
// Axios is a wrapper around the browser's fetch() API. It adds:
//   - Automatic JSON serialization/deserialization
//   - Interceptors (middleware for requests/responses)
//   - Better error handling (fetch doesn't throw on 4xx/5xx responses)
//   - Request/response transformation
//
// ── The Auth Interceptor ─────────────────────────────────────────────────────
// Instead of manually adding "Authorization: Bearer <token>" to every request,
// we add an interceptor that automatically attaches the token.
// This is a common pattern — configure once, works everywhere.

import axios from "axios";

// Create an axios instance with default config.
// This is separate from the global axios object so our settings don't
// affect any other axios calls that might exist.
const api = axios.create({
  // All requests will be prefixed with /api.
  // In development, Vite's proxy forwards /api/* to localhost:3001.
  // In production, this would be your server's URL.
  baseURL: "/api",

  // Default headers for every request
  headers: {
    "Content-Type": "application/json",
  },
});

// ── Request Interceptor ───────────────────────────────────────────────────────
// Runs before EVERY request. We use it to attach the JWT token.
api.interceptors.request.use((config) => {
  // Read the token from localStorage.
  // localStorage persists across browser sessions (unlike sessionStorage).
  const token = localStorage.getItem("token");

  if (token) {
    // Attach the token to the Authorization header.
    // "Bearer" is the token type — it's a convention for JWT tokens.
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// ── Response Interceptor ──────────────────────────────────────────────────────
// Runs after EVERY response. We use it to handle auth errors globally.
api.interceptors.response.use(
  // Success: just pass the response through
  (response) => response,

  // Error: handle specific status codes
  (error) => {
    const url: string = error.config?.url ?? "";
    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/register");

    if (error.response?.status === 401 && !isAuthEndpoint) {
      // Token expired or invalid — clear stored credentials and redirect to login.
      // This ensures the user is redirected to login from anywhere in the app.
      // Skip auth endpoints: a failed login is expected, not a session expiry.
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }

    // Re-throw so individual call sites can also handle the error if needed
    return Promise.reject(error);
  }
);

export default api;
