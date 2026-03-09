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
  redis,
  keys,
  getLobbyMeta,
  getLobbyPlayers,
  setLobbyPlayer,
  getGameState,
} from "../services/redis.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  GameState,
} from "./types.js";
import { handleLobbyEvents, scheduleLobbyClose, cancelLobbyClose } from "./lobbyHandler.js";
import { handleGameEvents, startDisconnectTimer, cancelDisconnectTimer } from "./gameHandler.js";
import { checkSocketRateLimit } from "../middleware/rateLimiter.js";

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

    // ── Auto-Reconnect ─────────────────────────────────────────────────────
    // Check if this user was in an active lobby or game when they disconnected.
    // This fires when they refresh the page or navigate back to the game URL.
    const currentCode = await redis.get(keys.playerCurrent(userId));
    if (currentCode) {
      const meta = await getLobbyMeta(currentCode);

      if (meta?.status === "in_progress") {
        // Was in an active game — rejoin the room and cancel the disconnect timer
        const gameState = await getGameState<GameState>(currentCode);
        if (gameState) {
          socket.join(`game:${currentCode}`);
          socket.data.code = currentCode;
          socket.data.isSpectator = false;

          cancelDisconnectTimer(currentCode, userId, username, io);

          // Send the current game state so the reconnected player is caught up
          socket.emit("game:stateUpdate", gameState);
          console.log(`${username} reconnected to game ${currentCode}`);
        }
      } else if (meta?.status === "waiting") {
        // Was in a waiting lobby — rejoin the room
        const players = await getLobbyPlayers(currentCode);
        const player = players.find((p) => p.userId === userId);
        if (player) {
          await setLobbyPlayer(currentCode, { ...player, isConnected: true });
          socket.join(`game:${currentCode}`);
          socket.data.code = currentCode;
          socket.data.isSpectator = false;

          // Cancel any pending lobby-close timer (owner reconnected in time)
          cancelLobbyClose(currentCode);

          // Broadcast updated player list (shows them as connected again)
          const updatedPlayers = await getLobbyPlayers(currentCode);
          io.to(`game:${currentCode}`).emit("lobby:updated", {
            players: updatedPlayers,
            maxPlayers: meta.maxPlayers,
            ownerId: meta.ownerId,
          });
          console.log(`${username} reconnected to lobby ${currentCode}`);
        }
      }
    }

    // ── Register Event Handlers ────────────────────────────────────────────
    handleLobbyEvents(socket, io);
    handleGameEvents(socket, io);

    // ── Chat ───────────────────────────────────────────────────────────────
    socket.on("chat:send", async ({ message }) => {
      const { code } = socket.data;
      if (!code) return;

      const allowed = await checkSocketRateLimit(userId, "chat", 10, 5);
      if (!allowed) return;

      const clean = message.trim().slice(0, 200);
      if (!clean) return;

      io.to(`game:${code}`).emit("chat:message", {
        userId,
        username: socket.data.username,
        message: clean,
        timestamp: Date.now(),
      });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("disconnect", async (reason) => {
      console.log(`Socket disconnected: ${username} — reason: ${reason}`);

      const { code, isSpectator } = socket.data;
      if (!code) return;

      const meta = await getLobbyMeta(code);

      if (meta?.status === "in_progress" && !isSpectator) {
        // Disconnected from an active game — give them 60s to reconnect
        startDisconnectTimer(code, userId, username, io);
      } else if (meta?.status === "waiting") {
        // Disconnected from a waiting lobby — mark as disconnected but keep them
        // in the lobby so they can rejoin via refresh or direct URL navigation.
        const players = await getLobbyPlayers(code);
        const player = players.find((p) => p.userId === userId);
        if (player) {
          await setLobbyPlayer(code, { ...player, isConnected: false });
        }

        // Broadcast updated connected state to everyone remaining in the room
        const updatedPlayers = await getLobbyPlayers(code);
        io.to(`game:${code}`).emit("lobby:updated", {
          players: updatedPlayers,
          maxPlayers: meta.maxPlayers,
          ownerId: meta.ownerId,
        });

        if (meta.ownerId === userId) {
          // Owner left — schedule lobby close after a grace period.
          // If they reconnect (e.g. page refresh) the timer is cancelled.
          scheduleLobbyClose(code, username, io);
        }
      }
    });
  });
}
