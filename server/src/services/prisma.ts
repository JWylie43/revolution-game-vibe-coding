// services/prisma.ts
//
// Creates and exports a single PrismaClient instance.
//
// WHY A SINGLETON: PrismaClient manages a connection pool to PostgreSQL.
// A "connection pool" is a set of pre-opened database connections that get reused.
// Opening a new DB connection is expensive (takes ~100ms). Pooling keeps
// connections open and hands them out to queries, then reclaims them.
//
// If you created "new PrismaClient()" in every file that needs the DB,
// you'd create a new connection pool for each — eventually exhausting the
// database's connection limit.
//
// Solution: create ONE instance here and import it everywhere.

import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

// The "declare global" trick prevents creating a new client every time
// the module reloads in development (tsx watch re-imports modules on save).
// In development, we store the client on the global object so it persists
// across module reloads. In production this doesn't matter (no hot reload).
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Create the client with logging.
// In development, we log all queries to the console so you can see exactly
// what SQL is being generated. In production, only log errors.
const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: config.isDev ? ["query", "error", "warn"] : ["error"],
  });

// Store on global in development to survive hot reloads.
if (config.isDev) {
  globalThis.__prisma = prisma;
}

export default prisma;

// ── Usage example ─────────────────────────────────────────────────────────────
// import prisma from '../services/prisma.js'
//
// const user = await prisma.user.findUnique({ where: { id: '...' } })
// const games = await prisma.game.findMany({ where: { status: 'IN_PROGRESS' } })
