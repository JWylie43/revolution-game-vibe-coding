// src/index.ts
//
// The entry point for the server. This file:
//   1. Creates the Express app
//   2. Attaches middleware (CORS, JSON parsing, etc.)
//   3. Mounts routes
//   4. Creates an HTTP server (Node's built-in)
//   5. Attaches Socket.io to that HTTP server
//   6. Starts listening for connections
//
// WHY a separate HTTP server (not just express)?
// Socket.io needs access to the raw Node HTTP server to handle WebSocket
// upgrade requests. Express alone only handles regular HTTP.
// We create one HTTP server and attach BOTH Express and Socket.io to it.

import express from "express";
import { createServer } from "http";
import cors from "cors";
import { config } from "./config.js";
import { initializeSocket } from "./socket/index.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";

// ── Create Express App ─────────────────────────────────────────────────────────
const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
// Middleware runs on EVERY request before it reaches route handlers.

// CORS (Cross-Origin Resource Sharing)
// By default, browsers block requests from one origin (e.g. localhost:5173)
// to a different origin (e.g. localhost:3001). This is a browser security feature.
// We explicitly allow requests from our frontend URL.
app.use(cors({
  origin: config.clientUrls,
  credentials: true,  // Allow cookies (needed if you use httpOnly cookie auth)
}));

// JSON body parser
// Without this, req.body would be undefined for POST requests.
// This middleware reads the request body and parses it as JSON.
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────────
// Mount route handlers at path prefixes.
// rate limiters and other middleware are passed inside the route handlers
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// Health check endpoint — used by load balancers and monitoring tools
// to verify the server is running. Returns 200 OK.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler — catch-all for routes that don't exist
// This must be LAST — it only runs if no other route matched.
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── HTTP Server ────────────────────────────────────────────────────────────────
// createServer(app) creates a Node.js HTTP server using Express as the handler.
// Express handles regular HTTP requests.
// Socket.io intercepts WebSocket upgrade requests on the same server.
const httpServer = createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
// Attach Socket.io to the HTTP server. See socket/index.ts for details.
initializeSocket(httpServer);

// ── Start Server ───────────────────────────────────────────────────────────────
httpServer.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════╗
║  Revolution Game Server              ║
║  HTTP  → http://localhost:${config.port}     ║
║  WS    → ws://localhost:${config.port}       ║
║  Env   → ${config.nodeEnv.padEnd(26)}║
╚══════════════════════════════════════╝
  `);
});

// Graceful shutdown: when the process receives SIGTERM (e.g. from Docker),
// close the server cleanly rather than cutting connections abruptly.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
