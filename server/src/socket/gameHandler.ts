// socket/gameHandler.ts
//
// Handles Socket.io events during active gameplay.
//
// Design principles:
//   - All game RULES live in engine.ts (pure functions, no I/O)
//   - This file handles the "wiring": receive event → validate → call engine → broadcast
//   - No DB writes per round — only write to Postgres when the game ends normally
//   - Disconnect = 60s grace period; if player doesn't return, game closes for everyone

import type { Server, Socket } from "socket.io";
import { getGameState, setGameState, deleteGameState, redis, keys } from "../services/redis.js";
import { engine } from "../game/engine.js";
import { checkSocketRateLimit } from "../middleware/rateLimiter.js";
import prisma from "../services/prisma.js";
import type { GameState } from "./types.js";
import type {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData,
} from "./types.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ── Disconnect Timers ──────────────────────────────────────────────────────────
// Keyed by "${code}:${userId}". When a player disconnects, we give them 60 seconds
// to reconnect before closing the entire game.
// In-memory is acceptable: if the server crashes, the game is gone anyway.
const disconnectTimers = new Map<string, NodeJS.Timeout>();

const DISCONNECT_TIMEOUT_MS = 60_000; // 60 seconds to reconnect

export function startDisconnectTimer(
    code: string,
    userId: string,
    username: string,
    io: AppServer
): void {
    const key = `${code}:${userId}`;
    if (disconnectTimers.has(key)) return; // Timer already running

    console.log(`[disconnect] ${username} left game ${code} — closing in 60s if no reconnect`);

    // Mark the player as disconnected in the live game state
    getGameState<GameState>(code).then(async (state) => {
        if (!state) return;

        const updated: GameState = {
            ...state,
            players: state.players.map((p) =>
                p.userId === userId ? { ...p, isConnected: false } : p
            ),
        };
        await setGameState(code, updated);

        // Tell other players someone disconnected and how long they have to wait
        io.to(`game:${code}`).emit("game:playerDisconnected", {
            userId,
            username,
            secondsRemaining: DISCONNECT_TIMEOUT_MS / 1000,
        });
        io.to(`game:${code}`).emit("game:stateUpdate", updated);
    });

    const timer = setTimeout(async () => {
        disconnectTimers.delete(key);
        console.log(`[disconnect] ${username} did not reconnect — closing game ${code}`);
        await closeGame(code, `${username} did not reconnect in time`, io);
    }, DISCONNECT_TIMEOUT_MS);

    disconnectTimers.set(key, timer);
}

export function cancelDisconnectTimer(
    code: string,
    userId: string,
    username: string,
    io: AppServer
): void {
    const key = `${code}:${userId}`;
    const timer = disconnectTimers.get(key);
    if (!timer) return;

    clearTimeout(timer);
    disconnectTimers.delete(key);
    console.log(`[disconnect] ${username} reconnected to game ${code}`);

    // Mark them as connected again in the game state and notify others
    getGameState<GameState>(code).then(async (state) => {
        if (!state) return;

        const updated: GameState = {
            ...state,
            players: state.players.map((p) =>
                p.userId === userId ? { ...p, isConnected: true } : p
            ),
        };
        await setGameState(code, updated);

        io.to(`game:${code}`).emit("game:playerReconnected", { userId, username });
        io.to(`game:${code}`).emit("game:stateUpdate", updated);
    });
}

export async function closeGame(code: string, reason: string, io: AppServer): Promise<void> {
    // Clean up any remaining disconnect timers for this game
    for (const [key, timer] of Array.from(disconnectTimers.entries())) {
        if (key.startsWith(`${code}:`)) {
            clearTimeout(timer);
            disconnectTimers.delete(key);
        }
    }

    // Delete the game state from Redis
    await deleteGameState(code);

    // Notify all players — they'll navigate to "/"
    io.to(`game:${code}`).emit("game:closed", { reason });
}

// ── Register Game Event Handlers ───────────────────────────────────────────────
export function handleGameEvents(socket: AppSocket, io: AppServer): void {
    // ── game:submitBids ────────────────────────────────────────────────────────
    // Player submits their bids for the current round.
    // Bids are stored secretly in Redis until all players have submitted,
    // then resolveRound() reveals them all at once.
    socket.on("game:submitBids", async ({ bids }, callback) => {
        const { userId, code, isSpectator } = socket.data;

        // Spectators cannot submit bids
        if (isSpectator) {
            callback({ success: false, error: "Spectators cannot bid" });
            return;
        }

        const allowed = await checkSocketRateLimit(userId, "submitBids", 3, 5);
        if (!allowed) {
            callback({ success: false, error: "Too many bid submissions. Please wait." });
            return;
        }

        if (!code) {
            callback({ success: false, error: "You are not in an active game" });
            return;
        }

        const state = await getGameState<GameState>(code);
        if (!state) {
            callback({ success: false, error: "Game state not found" });
            return;
        }

        if (state.phase !== "BID_PHASE") {
            callback({ success: false, error: `Cannot bid during ${state.phase} phase` });
            return;
        }

        const playerState = state.players.find((p) => p.userId === userId);
        if (!playerState) {
            callback({ success: false, error: "Player not found in game" });
            return;
        }

        if (playerState.hasSubmittedBids) {
            callback({ success: false, error: "You already submitted bids this round" });
            return;
        }

        const validation = engine.validateBids(bids, playerState);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }

        // Store bids secretly in Redis — other players can't read this key
        await redis.set(keys.pendingBids(code, userId), JSON.stringify(bids), "EX", 3600);

        // Mark this player as having submitted in shared state
        const updatedState = engine.markBidsSubmitted(state, userId);
        await setGameState(code, updatedState);

        callback({ success: true });
        socket.emit("game:bidAccepted", { blockId: "all" });

        // Broadcast updated state (everyone can see this player is "done")
        io.to(`game:${code}`).emit("game:stateUpdate", updatedState);

        // If all connected players submitted, resolve immediately
        const allSubmitted = updatedState.players
            .filter((p) => p.isConnected)
            .every((p) => p.hasSubmittedBids);

        if (allSubmitted) {
            await resolveRound(code, io);
        }
    });

    // ── game:leave ─────────────────────────────────────────────────────────────
    // Player explicitly leaves the game (navigated away within the SPA).
    // Starts the same 60s reconnect timer as a socket disconnect.
    socket.on("game:leave", () => {
        const { code, userId, username } = socket.data;
        if (!code || socket.data.isSpectator) return;

        // Clear their "current game" tracking — they intentionally left
        redis.del(keys.playerCurrent(userId));

        // Leave the room and start the timer
        socket.leave(`game:${code}`);
        socket.data.code = undefined;

        startDisconnectTimer(code, userId, username, io);
    });
}

// ── Resolve Round ──────────────────────────────────────────────────────────────
// Called when all connected players have submitted bids, or when the bid timer expires.
// Reveals all bids simultaneously and applies game rules.
export async function resolveRound(code: string, io: AppServer): Promise<void> {
    const state = await getGameState<GameState>(code);
    if (!state) return;

    // Set phase to RESOLVING so clients can show an animation
    const resolvingState: GameState = { ...state, phase: "RESOLVING" };
    await setGameState(code, resolvingState);
    io.to(`game:${code}`).emit("game:stateUpdate", resolvingState);

    // Collect all pending bids from Redis (one key per player)
    const allBids: Record<string, unknown[]> = {};
    for (const player of state.players) {
        const raw = await redis.get(keys.pendingBids(code, player.userId));
        if (raw) {
            allBids[player.userId] = JSON.parse(raw);
            await redis.del(keys.pendingBids(code, player.userId));
        }
    }

    // Run the game rules (pure function — no side effects)
    const { newState, results } = engine.resolveRound(state, allBids);
    await setGameState(code, newState);

    // Broadcast results — bids are now public
    io.to(`game:${code}`).emit("game:roundResolved", results);
    io.to(`game:${code}`).emit("game:stateUpdate", newState);

    if (newState.phase === "GAME_OVER") {
        // Write completed game to Postgres (the only DB write in the entire game)
        try {
            await saveCompletedGame(code, newState);
        } catch (err) {
            console.error(`Failed to save completed game ${code}:`, err);
            // Non-fatal — game over is still broadcast even if DB write fails
        }

        const winner = newState.players.reduce((a, b) => (a.score > b.score ? a : b));
        io.to(`game:${code}`).emit("game:over", {
            winnerId: winner.userId,
            winnerUsername: winner.username,
            finalScores: newState.players.map((p) => ({
                userId: p.userId,
                username: p.username,
                score: p.score,
            })),
        });

        // Clean up game state from Redis after a short delay
        // (delay so any late stateUpdate listeners get the final state)
        setTimeout(() => {
            deleteGameState(code);
        }, 30_000);
    } else {
        // Pause between rounds so players can review results, then start the next round
        setTimeout(async () => {
            const nextRoundState = engine.startNextRound(newState);
            await setGameState(code, nextRoundState);
            io.to(`game:${code}`).emit("game:stateUpdate", nextRoundState);
        }, 5000);
    }
}

// ── saveCompletedGame ──────────────────────────────────────────────────────────
// Writes one CompletedGame row to Postgres when phase === "GAME_OVER".
// Player scores, placements, and usernames are all inside finalState JSON —
// query by userId later with a JSONB containment:
//   WHERE final_state->'players' @> '[{"userId":"abc"}]'
async function saveCompletedGame(code: string, finalState: GameState): Promise<void> {
    await prisma.completedGame.create({
        data: {
            code,
            durationMs: 0, // placeholder — add startedAt to GameState to calculate properly
            finalState: finalState as object,
        },
    });
}
