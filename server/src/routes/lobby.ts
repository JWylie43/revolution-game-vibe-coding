// routes/lobby.ts
//
// HTTP routes for lobby operations.
// Socket events handle the real-time join/leave/ready flow;
// this REST endpoint is used for the lobby browser (list of open games).

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { redis, keys } from "../services/redis.js";
import type { SessionMeta, LobbyPlayer } from "../services/redis.js";

const router = Router();

// GET /api/lobby/list
// Returns all lobbies with status "waiting", enriched with player counts
// and the owner's username (read from the lobby players hash).
router.get("/list", requireAuth, async (_req, res) => {
    try {
        const metaKeys = await redis.keys("session:*:meta");

        if (metaKeys.length === 0) {
            res.json({ lobbies: [] });
            return;
        }

        const rawMetas = await Promise.all(metaKeys.map((k) => redis.get(k)));

        const waiting: (SessionMeta & { code: string })[] = [];
        for (let i = 0; i < metaKeys.length; i++) {
            const raw = rawMetas[i];
            if (!raw) continue;
            const meta = JSON.parse(raw) as SessionMeta;
            if (meta.status === "waiting") {
                waiting.push({ ...meta, code: meta.code });
            }
        }

        const lobbies = await Promise.all(
            waiting.map(async (meta) => {
                const [playerCount, ownerRaw] = await Promise.all([
                    redis.hlen(keys.lobbyPlayers(meta.code)),
                    redis.hget(keys.lobbyPlayers(meta.code), meta.ownerId),
                ]);
                const ownerUsername = ownerRaw
                    ? (JSON.parse(ownerRaw) as LobbyPlayer).username
                    : "Unknown";
                return {
                    code: meta.code,
                    ownerUsername,
                    playerCount,
                    maxPlayers: meta.maxPlayers,
                    createdAt: meta.createdAt,
                };
            })
        );

        lobbies.sort((a, b) => b.createdAt - a.createdAt);

        res.json({ lobbies });
    } catch (err) {
        console.error("lobby list error:", err);
        res.status(500).json({ error: "Failed to fetch lobbies" });
    }
});

export default router;
