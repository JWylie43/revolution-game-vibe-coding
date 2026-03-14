// socket/index.ts
//
// Sets up the Socket.io server, authenticates connections, and routes events.
//
// ── Connection Lifecycle ──────────────────────────────────────────────────────
// 1. Client connects with JWT in handshake.auth.token
// 2. Auth middleware verifies token, attaches userId/username to socket.data
// 3. "connection" handler fires → check Redis for an active lobby/game (reconnect)
// 4. If reconnecting to a game → cancel any pending disconnect timer
// 5. If reconnecting to a lobby → re-add to lobby room
// 6. Register event handlers (lobby, game, chat)
// 7. On disconnect → start 60s timer if in an active game; remove from lobby if waiting

import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import type { TokenPayload } from "../middleware/auth.js";
import { config } from "../config.js";
import {
    redisPub,
    redisSub,
    getSessionMeta,
    setSessionMeta,
    getLobbyPlayers,
    setLobbyPlayer,
    removeLobbyPlayer,
    getGameState,
} from "../services/redis.js";
import type {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData,
    GameState,
} from "./types.js";
import { handleLobbyEvents, cancelCountdown, closeLobby } from "./lobbyHandler.js";
import { handleGameEvents, startDisconnectTimer, cancelDisconnectTimer } from "./gameHandler.js";

export let io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function initializeSocket(httpServer: HttpServer): void {
    io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
        httpServer,
        {
            cors: {
                origin: config.clientUrls,
                methods: ["GET", "POST"],
                credentials: true,
            },
            transports: ["polling", "websocket"],
        }
    );

    // ── Redis Adapter ──────────────────────────────────────────────────────────
    // Syncs Socket.io rooms across multiple server instances.
    io.adapter(createAdapter(redisPub, redisSub));

    // ── Authentication Middleware ──────────────────────────────────────────────
    // Runs before the "connection" event. Rejects unauthenticated sockets.
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) return next(new Error("Authentication required"));

        try {
            const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
            socket.data.userId = payload.userId;
            socket.data.username = payload.username;
            socket.data.code = undefined;
            socket.data.isSpectator = false;
            next();
        } catch {
            next(new Error("Invalid or expired token"));
        }
    });

    // ── Connection Handler ─────────────────────────────────────────────────────
    io.on("connection", async (socket) => {
        const { userId, username } = socket.data;
        console.log(`Socket connected: ${username} (${socket.id})`);

        // ── Register Event Handlers ────────────────────────────────────────────
        handleLobbyEvents(socket, io);
        handleGameEvents(socket, io);

        // ── Disconnect ─────────────────────────────────────────────────────────
        socket.on("disconnect", async (reason) => {
            console.log(`Socket disconnected: ${username} — reason: ${reason}`);

            const { code, isSpectator } = socket.data;
            if (!code) return;

            const meta = await getSessionMeta(code);

            if (meta?.status === "in_progress" && !isSpectator) {
                // Don't start a rejoin timer if the game is already finished
                const gameState = await getGameState(code);
                if (gameState?.phase === "GAME_OVER") return;

                // Disconnected from an active game — give them 60s to reconnect
                startDisconnectTimer(code, userId, username, io);
                io.to(`game:${code}`).emit("notification:playerLeft", { username });
            } else if (meta?.status === "waiting") {
                // Remove the player entirely and compact remaining seat numbers
                await removeLobbyPlayer(code, userId);
                const remaining = await getLobbyPlayers(code);
                for (const [i, p] of remaining.entries()) {
                    if (p.seatNumber !== i) await setLobbyPlayer(code, { ...p, seatNumber: i });
                }

                // If a countdown was running, cancel it — can't start with a missing player
                cancelCountdown(code, io);

                if (meta.ownerId === userId) {
                    if (remaining.length === 0) {
                        await closeLobby(code, "All players have left", io);
                        return;
                    }
                    // Transfer ownership to the first remaining player
                    const newOwner = remaining[0];
                    await setSessionMeta(code, { ...meta, ownerId: newOwner.userId });
                    io.to(`game:${code}`).emit("lobby:updated", {
                        players: remaining.map((p, i) => ({ ...p, seatNumber: i })),
                        ownerId: newOwner.userId,
                    });
                    io.to(`game:${code}`).emit("notification:playerLeft", { username });
                    io.to(`game:${code}`).emit("notification:ownerChanged", {
                        newOwnerUsername: newOwner.username,
                    });
                } else {
                    io.to(`game:${code}`).emit("lobby:updated", {
                        players: remaining.map((p, i) => ({ ...p, seatNumber: i })),
                        ownerId: meta.ownerId,
                    });
                    io.to(`game:${code}`).emit("notification:playerLeft", { username });
                }
            }
        });
    });
}
