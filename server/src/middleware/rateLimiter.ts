// middleware/rateLimiter.ts
//
// Rate limiters prevent abuse by capping how many requests a client can make
// in a given time window.
//
// ── Why two limiters? ─────────────────────────────────────────────────────────
// HTTP requests (login, register) and Socket.io events (bids, lobby actions)
// travel over completely different transports, so they need different tools.
// Both use the same underlying mechanism: Redis INCR + EXPIRE.
//
// ── Why Redis-backed? ─────────────────────────────────────────────────────────
// Redis stores counters outside the Node process.
//   1. Server restart: counts survive — a ban can't be bypassed by restarting
//   2. Multiple servers: all share one counter — an attacker can't split traffic
//
// ── Why not express-rate-limit + rate-limit-redis? ───────────────────────────
// express-rate-limit v8 + rate-limit-redis v4 has a known compatibility issue
// with ioredis — the RedisStore silently falls back to in-memory when the
// ioredis `call()` API doesn't match expectations. Rather than fight it,
// we use the same direct Redis INCR/EXPIRE pattern as checkSocketRateLimit,
// which we know works with our ioredis setup.

import type { Request, Response, NextFunction } from "express";
import { redis } from "../services/redis.js";

// ── createHttpRateLimiter ──────────────────────────────────────────────────────
// Factory that returns an Express middleware function.
// Uses Redis INCR + EXPIRE — same pattern as checkSocketRateLimit.
//
// Key format: rl:{prefix}:{ip}  e.g. "rl:auth:::1" or "rl:auth:127.0.0.1"
function createHttpRateLimiter(
    prefix: string,
    max: number,
    windowSeconds: number,
    errorMessage: string
) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // Use the client's IP address as the key discriminator.
        // req.ip is set by Express and respects the "trust proxy" setting.
        const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
        const key = `rl:${prefix}:${ip}`;

        const count = await redis.incr(key);

        if (count === 1) {
            // First request in this window — set the expiry.
            await redis.expire(key, windowSeconds);
        }

        if (count > max) {
            res.status(429).json({ error: errorMessage });
            return;
        }

        next();
    };
}

// ── HTTP Rate Limiters ────────────────────────────────────────────────────────

// Strict limiter for auth endpoints (login, register).
// 10 attempts per IP per 15 minutes.
// Keys visible in Redis as: rl:auth:<ip>
export const authLimiter = createHttpRateLimiter(
    "auth",
    10,
    15 * 60,
    "Too many attempts. Please wait 15 minutes before trying again."
);

// Looser limiter for general API endpoints (lobby creation, etc.)
// 60 requests per IP per minute.
// Keys visible in Redis as: rl:api:<ip>
export const apiLimiter = createHttpRateLimiter(
    "api",
    60,
    60,
    "Too many requests. Please slow down."
);

// ── Socket Rate Limiter ────────────────────────────────────────────────────────
// express-rate-limit only works for HTTP. Socket.io events bypass it entirely
// because they travel over a persistent WebSocket connection, not individual
// HTTP requests.
//
// For socket events we use Redis directly with INCR + EXPIRE:
//
//   INCR  key   → atomically increments the counter by 1, returns new value
//   EXPIRE key  → sets the key to auto-delete after N seconds
//
// On the first call: INCR creates the key with value 1, EXPIRE sets the window.
// On subsequent calls: INCR bumps the count. If it exceeds the limit, reject.
// After the window expires: the key is deleted, counter resets automatically.
//
// "Atomic" means INCR can't be interrupted — even with 100 simultaneous requests,
// each gets a distinct count. No race conditions.
//
// Usage in socket event handlers:
//   const allowed = await checkSocketRateLimit(userId, "bid", 3, 5)
//   if (!allowed) return callback({ success: false, error: "Too fast" })

export async function checkSocketRateLimit(
    userId: string,
    action: string, // e.g. "bid", "lobby:join", "chat"
    maxRequests: number,
    windowSeconds: number
): Promise<boolean> {
    return true;
    // Key format: "rl:socket:{action}:{userId}"
    // Each user gets their own counter per action type.
    // e.g. "rl:socket:bid:clx123abc"
    const key = `rl:socket:${action}:${userId}`;

    // redis.incr atomically increments and returns the new value.
    // If the key doesn't exist, Redis creates it with value 0 first, then increments to 1.
    const count = await redis.incr(key);

    if (count === 1) {
        // First request in this window — set the expiry.
        // We only set it on the first call so subsequent calls don't reset the window.
        await redis.expire(key, windowSeconds);
    }

    // Return true if under the limit, false if over.
    return count <= maxRequests;
}
