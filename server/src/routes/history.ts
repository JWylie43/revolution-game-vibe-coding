// routes/history.ts
//
// Read-only endpoints for completed game history.
//   GET /api/history          — last 20 games the current user played (summaries)
//   GET /api/history/:id      — full detail of one game including per-round snapshots
//
// All queries are scoped to the authenticated user: a player can only see games
// they personally participated in.

import { Router } from "express";
import prisma from "../services/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// Apply auth + rate-limit to every route in this file
router.use(apiLimiter, requireAuth);

// ── GET /api/history ────────────────────────────────────────────────────────────
// Returns up to `limit` completed games (default 20, max 50) where the current
// user was one of the players, newest first.
//
// Prisma's ORM doesn't natively support PostgreSQL JSONB @> containment, so we
// fetch the 500 most recent games and filter by userId in JavaScript. This is
// fast enough for a personal history page and avoids raw SQL quoting pitfalls.
// The finalState column is included; roundHistory is excluded to keep responses light.
router.get("/", async (req, res) => {
    try {
        const { userId } = req.user!;
        const limit  = Math.min(Number(req.query.limit)  || 20, 50);
        const offset = Math.max(Number(req.query.offset) || 0,  0);

        const all = await prisma.completedGame.findMany({
            orderBy: { playedAt: "desc" },
            select: {
                id:         true,
                code:       true,
                playedAt:   true,
                durationMs: true,
                finalState: true,
            },
            take: 500,
        });

        const games = all
            .filter((g: typeof all[number]) => {
                const fs = g.finalState as { players?: Array<{ userId: string }> };
                return fs.players?.some((p) => p.userId === userId) ?? false;
            })
            .slice(offset, offset + limit);

        res.json({ games });
    } catch (err) {
        console.error("history list error:", err);
        res.status(500).json({ error: "Failed to load history" });
    }
});

// ── GET /api/history/:id ────────────────────────────────────────────────────────
// Returns the full CompletedGame record including roundHistory for the detail
// modal. Verifies the requesting user was a participant before returning data.
router.get("/:id", async (req, res) => {
    try {
        const { userId } = req.user!;
        const { id }     = req.params;

        const game = await prisma.completedGame.findUnique({ where: { id } });
        if (!game) {
            res.status(404).json({ error: "Game not found" });
            return;
        }

        // Authorization: only players who were in this game may view it
        const fs = game.finalState as { players?: Array<{ userId: string }> };
        if (!fs.players?.some((p) => p.userId === userId)) {
            res.status(403).json({ error: "Access denied" });
            return;
        }

        res.json({ game });
    } catch (err) {
        console.error("history detail error:", err);
        res.status(500).json({ error: "Failed to load game detail" });
    }
});

export default router;
