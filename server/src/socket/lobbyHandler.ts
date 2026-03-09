// socket/lobbyHandler.ts
//
// Handles Socket.io events for the pre-game lobby.
//
// Lobby lifecycle:
//   1. Player creates a game via REST → lobby stored in Redis → navigates to /lobby/:code
//   2. LobbyRoomPage mounts → emits "lobby:join" → socket joins the room, Redis updated
//   3. Other players navigate to /lobby/:code → same flow
//   4. Each player emits "lobby:ready" when ready
//   5. All ready (min 2) → 5-second countdown → game starts
//
// Owner can kick players at any point before the game starts.
// If a player refreshes, they reconnect and are put back in the room automatically.
// If the owner disconnects, the lobby closes.

import type { Server, Socket } from "socket.io";
import {
  getLobbyMeta,
  setLobbyMeta,
  getLobbyPlayers,
  setLobbyPlayer,
  removeLobbyPlayer,
  deleteLobby,
  setGameState,
  getGameState,
  redis,
  keys,
} from "../services/redis.js";
import { checkSocketRateLimit } from "../middleware/rateLimiter.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  GameState,
} from "./types.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ── Countdown Timers ───────────────────────────────────────────────────────────
// Tracks pending "game starting in X seconds" timers keyed by lobby code.
// When a player unreadies, we cancel and reset the countdown here.
// In-memory is fine — all sockets for a game are in the same room via Redis adapter,
// but timers still need to live on one server instance.
const pendingCountdowns = new Map<string, NodeJS.Timeout>();

// ── Lobby Close Timers ────────────────────────────────────────────────────────
// When the owner disconnects from a waiting lobby, we don't close immediately.
// Instead we give them 60 seconds to reconnect (e.g. browser refresh).
// If they reconnect, cancelLobbyClose() stops the timer.
const pendingLobbyClose = new Map<string, NodeJS.Timeout>();

const LOBBY_OWNER_RECONNECT_WINDOW_MS = 60_000;

export function scheduleLobbyClose(code: string, ownerUsername: string, io: AppServer): void {
  if (pendingLobbyClose.has(code)) return; // timer already running

  const timer = setTimeout(async () => {
    pendingLobbyClose.delete(code);
    await closeLobby(code, `${ownerUsername} (the owner) left the lobby`, io);
  }, LOBBY_OWNER_RECONNECT_WINDOW_MS);

  pendingLobbyClose.set(code, timer);
}

export function cancelLobbyClose(code: string): void {
  const timer = pendingLobbyClose.get(code);
  if (timer) {
    clearTimeout(timer);
    pendingLobbyClose.delete(code);
  }
}

// ── Broadcast Lobby State ──────────────────────────────────────────────────────
// Helper to read current lobby state from Redis and send it to everyone in the room.
async function broadcastLobbyUpdate(code: string, io: AppServer): Promise<void> {
  const [meta, players] = await Promise.all([
    getLobbyMeta(code),
    getLobbyPlayers(code),
  ]);
  if (!meta) return;

  io.to(`game:${code}`).emit("lobby:updated", {
    players,
    maxPlayers: meta.maxPlayers,
    ownerId: meta.ownerId,
  });
}

export function handleLobbyEvents(socket: AppSocket, io: AppServer): void {

  // ── lobby:join ─────────────────────────────────────────────────────────────
  // Emitted by LobbyRoomPage on mount. Adds the player to the lobby or,
  // if the game is already running, connects them as a spectator.
  socket.on("lobby:join", async ({ code }, callback) => {
    const { userId, username } = socket.data;

    const allowed = await checkSocketRateLimit(userId, "lobbyJoin", 5, 10);
    if (!allowed) {
      callback({ success: false, error: "Too many join attempts. Please wait." });
      return;
    }

    try {
      // Validate code format: lowercase alphanumeric, 3–32 chars
      if (!/^[a-z0-9]{3,32}$/.test(code)) {
        callback({ success: false, error: "Invalid room code. Use letters and numbers only (3–32 chars)." });
        return;
      }

      let meta = await getLobbyMeta(code);

      // ── Create lobby on first visit ───────────────────────────────────────
      // If the lobby doesn't exist yet, the first person to navigate to this
      // URL becomes the owner and the lobby is created automatically.
      if (!meta) {
        meta = {
          code,
          ownerId: userId,
          maxPlayers: 4,
          status: "waiting",
          createdAt: Date.now(),
        };
        await setLobbyMeta(code, meta);
        await setLobbyPlayer(code, {
          userId,
          username,
          avatarUrl: null,
          seatNumber: 0,
          isReady: false,
          isConnected: true,
        });
        await redis.set(keys.playerCurrent(userId), code, "EX", 86400);
        socket.join(`game:${code}`);
        socket.data.code = code;
        socket.data.isSpectator = false;
        await broadcastLobbyUpdate(code, io);
        callback({ success: true, isSpectator: false });
        return;
      }

      // ── Game already started ──────────────────────────────────────────────
      if (meta.status === "in_progress") {
        const gameState = await getGameState<GameState>(code);
        if (!gameState) {
          callback({ success: false, error: "Game not found" });
          return;
        }

        const isPlayer = gameState.players.some((p) => p.userId === userId);

        socket.join(`game:${code}`);
        socket.data.code = code;
        socket.data.isSpectator = !isPlayer;

        callback({ success: true, isSpectator: !isPlayer, gameState });
        return;
      }

      if (meta.status !== "waiting") {
        callback({ success: false, error: "This lobby is closed" });
        return;
      }

      // ── Regular join: lobby is waiting ────────────────────────────────────
      const players = await getLobbyPlayers(code);

      // Check if the player is already in the lobby (reconnect case)
      const existing = players.find((p) => p.userId === userId);
      if (!existing) {
        // New player — check if there's room
        if (players.length >= meta.maxPlayers) {
          callback({ success: false, error: "Lobby is full" });
          return;
        }

        // Add them with the next available seat number
        await setLobbyPlayer(code, {
          userId,
          username,
          avatarUrl: null, // Not needed for lobby display
          seatNumber: players.length, // Join order determines seat
          isReady: false,
          isConnected: true,
        });
      } else {
        // Reconnecting — mark them as connected again
        await setLobbyPlayer(code, { ...existing, isConnected: true });
        // Cancel any pending lobby-close timer (owner reconnected in time)
        cancelLobbyClose(code);
      }

      // Track which lobby this user is in (for reconnect detection on next connect)
      await redis.set(keys.playerCurrent(userId), code, "EX", 86400);

      socket.join(`game:${code}`);
      socket.data.code = code;
      socket.data.isSpectator = false;

      await broadcastLobbyUpdate(code, io);
      callback({ success: true, isSpectator: false });
    } catch (err) {
      console.error("lobby:join error:", err);
      callback({ success: false, error: "Server error" });
    }
  });

  // ── lobby:ready ────────────────────────────────────────────────────────────
  // Toggle this player's ready state. When all players are ready,
  // a 5-second countdown starts before the game launches.
  socket.on("lobby:ready", async ({ ready }, callback) => {
    const { userId, code } = socket.data;
    if (!code) { callback({ success: false }); return; }

    const allowed = await checkSocketRateLimit(userId, "lobbyReady", 10, 30);
    if (!allowed) { callback({ success: false }); return; }

    try {
      const players = await getLobbyPlayers(code);
      const meta = await getLobbyMeta(code);
      if (!meta) { callback({ success: false }); return; }

      const player = players.find((p) => p.userId === userId);
      if (!player) { callback({ success: false }); return; }

      // Update this player's ready state in Redis
      await setLobbyPlayer(code, { ...player, isReady: ready });

      if (!ready) {
        // Player unreadied — cancel any active countdown
        const pending = pendingCountdowns.get(code);
        if (pending) {
          clearTimeout(pending);
          pendingCountdowns.delete(code);
          io.to(`game:${code}`).emit("lobby:countdown", { seconds: null });
        }
      }

      callback({ success: true });

      // Re-read the updated player list (our change is now in Redis)
      const updatedPlayers = await getLobbyPlayers(code);

      // Broadcast new ready state to everyone
      io.to(`game:${code}`).emit("lobby:updated", {
        players: updatedPlayers,
        maxPlayers: meta.maxPlayers,
        ownerId: meta.ownerId,
      });

      // Check if all players (min 2) are ready
      const allReady =
        updatedPlayers.length >= 2 &&
        updatedPlayers.every((p) => p.isReady);

      if (allReady && !pendingCountdowns.has(code)) {
        // Start the 5-second countdown
        io.to(`game:${code}`).emit("lobby:countdown", { seconds: 5 });

        const timer = setTimeout(async () => {
          pendingCountdowns.delete(code);

          // Re-check ready state — a player may have unreadied during the countdown.
          // If so, the timer above would have been cancelled, so we won't reach here.
          // This re-check guards against race conditions.
          const currentPlayers = await getLobbyPlayers(code);
          const stillAllReady =
            currentPlayers.length >= 2 &&
            currentPlayers.every((p) => p.isReady);

          if (stillAllReady) {
            await startGame(code, io);
          }
        }, 5000);

        pendingCountdowns.set(code, timer);
      }
    } catch (err) {
      console.error("lobby:ready error:", err);
      callback({ success: false });
    }
  });

  // ── lobby:kick ─────────────────────────────────────────────────────────────
  // Owner removes a player from the lobby. The kicked player is notified
  // and redirected to the home page on the client side.
  socket.on("lobby:kick", async ({ targetUserId }, callback) => {
    const { userId: requesterId, code } = socket.data;
    if (!code) { callback({ success: false, error: "Not in a lobby" }); return; }

    try {
      const meta = await getLobbyMeta(code);
      if (!meta) { callback({ success: false, error: "Lobby not found" }); return; }

      // Only the owner can kick
      if (requesterId !== meta.ownerId) {
        callback({ success: false, error: "Only the lobby owner can kick players" });
        return;
      }

      // Can't kick yourself
      if (targetUserId === requesterId) {
        callback({ success: false, error: "You cannot kick yourself" });
        return;
      }

      // Remove from lobby Redis hash
      await removeLobbyPlayer(code, targetUserId);

      // Clear their current-lobby tracking
      await redis.del(keys.playerCurrent(targetUserId));

      // Find and notify the kicked player's socket
      // io.in(room).fetchSockets() returns all sockets in the room
      const roomSockets = await io.in(`game:${code}`).fetchSockets();
      for (const s of roomSockets) {
        if (s.data.userId === targetUserId) {
          s.emit("lobby:kicked", { reason: "You were removed from the lobby" });
          s.leave(`game:${code}`);
          s.data.code = undefined;
          break;
        }
      }

      callback({ success: true });

      // Broadcast updated player list to remaining players
      await broadcastLobbyUpdate(code, io);
    } catch (err) {
      console.error("lobby:kick error:", err);
      callback({ success: false, error: "Server error" });
    }
  });
}

// ── Start Game ─────────────────────────────────────────────────────────────────
// Transitions the lobby from waiting → in_progress and launches the game.
// Called automatically after the 5-second countdown completes.
export async function startGame(code: string, io: AppServer): Promise<void> {
  const { engine } = await import("../game/engine.js");

  try {
    const [meta, players] = await Promise.all([
      getLobbyMeta(code),
      getLobbyPlayers(code),
    ]);

    if (!meta || meta.status !== "waiting") return;

    // Mark lobby as in progress — spectators joining later will see this
    await setLobbyMeta(code, {
      ...meta,
      status: "in_progress",
      startedAt: Date.now(),
    });

    // Build the players array for the engine
    // Each player object carries userId, username, and seatNumber
    const enginePlayers = players.map((p) => ({
      userId: p.userId,
      username: p.username,
      seatNumber: p.seatNumber,
    }));

    // Create the initial game state (pure function — no side effects)
    // We pass the lobby code as the "gameId" — engine doesn't care what the string is
    const initialState = engine.createInitialState(code, enginePlayers);

    // Store in Redis — this is the live game state from now on
    await setGameState(code, initialState);

    // Notify all players — they'll navigate to /game/:code
    io.to(`game:${code}`).emit("game:started", initialState);
  } catch (err) {
    console.error("startGame error:", err);
  }
}

// ── Close Lobby ────────────────────────────────────────────────────────────────
// Called when the owner disconnects or all players leave.
// Notifies remaining clients and cleans up Redis.
export async function closeLobby(code: string, reason: string, io: AppServer): Promise<void> {
  await deleteLobby(code);

  // Notify everyone still in the room
  io.to(`game:${code}`).emit("game:closed", { reason });
}
