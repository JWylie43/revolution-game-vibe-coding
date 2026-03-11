// services/redis.ts
//
// Redis clients, key helpers, and lobby/game state utilities.
//
// ── Architecture ──────────────────────────────────────────────────────────────
// Redis stores ALL ephemeral state: lobbies, active games, player connections.
// Postgres only stores completed game records and user accounts.
//
// ── Key Namespaces ────────────────────────────────────────────────────────────
//   session:{code}:meta          → JSON string of SessionMeta
//   lobby:{code}:players         → Hash { userId: JSON(LobbyPlayer) }
//   game:{code}:state            → JSON string of GameState
//   game:{code}:pendingBids:{userId} → JSON string of BidSubmission[]
//   player:{userId}:current      → string code of the lobby/game they're in
//   socket:{socketId}:userId     → string userId

import { Redis } from "ioredis";
import { config } from "../config.js";

// ── Connection Options ─────────────────────────────────────────────────────────
const connectionOptions = {
    retryStrategy: (retries: number) => {
        if (retries > 10) {
            console.error("Redis: too many retries, giving up");
            return null;
        }
        // Exponential backoff: 50ms, 100ms, 200ms... up to 3s
        return Math.min(retries * 50, 3000);
    },
};

// ── Clients ────────────────────────────────────────────────────────────────────
// Main client for all game/lobby state operations
export const redis = new Redis(config.redisUrl, connectionOptions);

// Pub/sub pair for Socket.io Redis adapter (syncs rooms across server instances)
export const redisPub = new Redis(config.redisUrl, connectionOptions);
export const redisSub = new Redis(config.redisUrl, connectionOptions);

redis.on("connect", () => console.log("Redis: connected"));
redis.on("error", (err) => console.error("Redis error:", err));

// ── Key Helpers ────────────────────────────────────────────────────────────────
// Centralizes key naming. One place to change if the format ever needs to shift.
export const keys = {
    // Session metadata — tracks the full lifecycle (waiting → in_progress → closed)
    sessionMeta: (code: string) => `session:${code}:meta`,

    // Lobby player list — Hash: { userId → JSON(LobbyPlayer) }
    lobbyPlayers: (code: string) => `lobby:${code}:players`,

    // Active game state blob
    gameState: (code: string) => `game:${code}:state`,

    // One player's pending bids during bid phase (secret until all submit)
    pendingBids: (code: string, userId: string) => `game:${code}:pendingBids:${userId}`,

    // Which lobby/game a user is currently in (for reconnect)
    playerCurrent: (userId: string) => `player:${userId}:current`,
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SessionMeta {
    code: string;
    ownerId: string;
    maxPlayers: number;
    // "waiting" = pre-game lobby, "in_progress" = active game, "closed" = gone
    status: "waiting" | "in_progress" | "closed";
    createdAt: number; // unix timestamp (ms)
    startedAt?: number; // set when game transitions to in_progress
}

export interface LobbyPlayer {
    userId: string;
    username: string;
    avatarUrl: string | null;
    seatNumber: number; // 0-indexed join order
    isReady: boolean;
}

// ── Lobby Helpers ──────────────────────────────────────────────────────────────

// 24-hour TTL on all lobby/game keys so Redis self-cleans stale state
const LOBBY_TTL = 86400; // 60 * 60 * 24

export async function getSessionMeta(code: string): Promise<SessionMeta | null> {
    const raw = await redis.get(keys.sessionMeta(code));
    if (!raw) return null;
    return JSON.parse(raw) as SessionMeta;
}

export async function setSessionMeta(code: string, meta: SessionMeta): Promise<void> {
    await redis.set(keys.sessionMeta(code), JSON.stringify(meta), "EX", LOBBY_TTL);
}

// Get all players currently in a lobby as an array (sorted by seatNumber)
export async function getLobbyPlayers(code: string): Promise<LobbyPlayer[]> {
    // HGETALL returns an object: { userId1: jsonStr1, userId2: jsonStr2, ... }
    const raw = await redis.hgetall(keys.lobbyPlayers(code));
    if (!raw) return [];
    return Object.values(raw)
        .map((v) => JSON.parse(v) as LobbyPlayer)
        .sort((a, b) => a.seatNumber - b.seatNumber);
}

// Add or update a player in the lobby hash
export async function setLobbyPlayer(code: string, player: LobbyPlayer): Promise<void> {
    await redis.hset(keys.lobbyPlayers(code), player.userId, JSON.stringify(player));
    // Touch the TTL every time a player is set so active lobbies don't expire
    await redis.expire(keys.lobbyPlayers(code), LOBBY_TTL);
}

// Remove a player from the lobby hash
export async function removeLobbyPlayer(code: string, userId: string): Promise<void> {
    await redis.hdel(keys.lobbyPlayers(code), userId);
}

// Delete all session keys (cleanup when a session closes)
export async function deleteLobby(code: string): Promise<void> {
    await Promise.all([redis.del(keys.sessionMeta(code)), redis.del(keys.lobbyPlayers(code))]);
}

// ── Game State Helpers ─────────────────────────────────────────────────────────

export async function setGameState<T>(code: string, state: T): Promise<void> {
    await redis.set(keys.gameState(code), JSON.stringify(state), "EX", LOBBY_TTL);
}

export async function getGameState<T>(code: string): Promise<T | null> {
    const raw = await redis.get(keys.gameState(code));
    if (!raw) return null;
    return JSON.parse(raw) as T;
}

export async function deleteGameState(code: string): Promise<void> {
    await redis.del(keys.gameState(code));
}
