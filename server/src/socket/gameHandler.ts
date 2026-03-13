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

// ── finalizeGameIfOver ─────────────────────────────────────────────────────────
// Writes the completed game to Postgres, broadcasts game:over, and schedules
// Redis cleanup. Safe to call even if phase is not GAME_OVER (no-ops).
async function finalizeGameIfOver(code: string, state: GameState, io: AppServer): Promise<void> {
    if (state.phase !== "GAME_OVER") return;

    try {
        await saveCompletedGame(code, state);
    } catch (err) {
        console.error(`Failed to save completed game ${code}:`, err);
        // Non-fatal — game over is still broadcast even if DB write fails
    }

    const winner = state.players.reduce((a, b) => (a.score > b.score ? a : b));
    io.to(`game:${code}`).emit("game:over", {
        winnerId: winner.userId,
        winnerUsername: winner.username,
        finalScores: state.players.map((p) => ({
            userId: p.userId,
            username: p.username,
            score: p.score,
        })),
    });

    // Clean up game state from Redis after a short delay so late listeners get the final state
    setTimeout(() => {
        deleteGameState(code);
    }, 30_000);
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

    // ── game:resultsAck ────────────────────────────────────────────────────────
    // Player acknowledged round results. Once all connected players have acked,
    // the server advances to the next round.
    socket.on("game:resultsAck", async (callback) => {
        const { userId, code, isSpectator } = socket.data;

        if (isSpectator) {
            callback({ success: false, error: "Spectators cannot acknowledge results" });
            return;
        }
        if (!code) {
            callback({ success: false, error: "Not in an active game" });
            return;
        }

        const state = await getGameState<GameState>(code);
        if (!state) {
            callback({ success: false, error: "Game state not found" });
            return;
        }
        if (state.phase !== "ROUND_OVER") {
            callback({ success: false, error: "Not in ROUND_OVER phase" });
            return;
        }

        const updatedState = engine.ackResults(state, userId);
        await setGameState(code, updatedState);
        callback({ success: true });
        io.to(`game:${code}`).emit("game:stateUpdate", updatedState);

        // Advance to next round once every connected player has acknowledged
        const connectedPlayers = updatedState.players.filter((p) => p.isConnected);
        const allAcked = connectedPlayers.every((p) =>
            updatedState.resultsAckUserIds.includes(p.userId)
        );

        if (allAcked) {
            const nextRoundState = engine.startNextRound(updatedState);
            await setGameState(code, nextRoundState);
            io.to(`game:${code}`).emit("game:stateUpdate", nextRoundState);
        }
    });

    // ── game:spyAction ─────────────────────────────────────────────────────────
    // The spy winner picks an opponent's cube to replace with their own.
    // Passing skip=true forfeits the action (the cube stays as-is).
    socket.on("game:spyAction", async ({ locationId, slotIndex, skip }, callback) => {
        const { userId, code, isSpectator } = socket.data;

        if (isSpectator) {
            callback({ success: false, error: "Spectators cannot perform actions" });
            return;
        }
        if (!code) {
            callback({ success: false, error: "Not in an active game" });
            return;
        }

        const state = await getGameState<GameState>(code);
        if (!state) {
            callback({ success: false, error: "Game state not found" });
            return;
        }
        if (state.phase !== "SPECIAL_ACTIONS") {
            callback({ success: false, error: "Not in SPECIAL_ACTIONS phase" });
            return;
        }

        const current = state.pendingSpecialActions[0];
        if (!current || current.userId !== userId || current.type !== "spy") {
            callback({ success: false, error: "Not your turn to perform a spy action" });
            return;
        }

        let currentState = state;

        if (!skip) {
            if (locationId === undefined || slotIndex === undefined) {
                callback({ success: false, error: "Must provide locationId and slotIndex" });
                return;
            }
            const result = engine.applySpyAction(state, userId, locationId, slotIndex);
            if ("error" in result) {
                callback({ success: false, error: result.error });
                return;
            }
            currentState = result.newState;
        }

        // Pop the completed action off the queue
        currentState = {
            ...currentState,
            pendingSpecialActions: currentState.pendingSpecialActions.slice(1),
        };

        // If the queue is empty, advance the round
        const nextState =
            currentState.pendingSpecialActions.length === 0
                ? engine.advanceAfterSpecialActions(currentState)
                : currentState;

        await setGameState(code, nextState);
        callback({ success: true });
        io.to(`game:${code}`).emit("game:stateUpdate", nextState);

        await finalizeGameIfOver(code, nextState, io);
    });

    // ── game:apothecaryAction ──────────────────────────────────────────────────
    // The apothecary winner picks two occupied cubes and swaps their positions.
    // Passing skip=true forfeits the action (the board stays as-is).
    socket.on("game:apothecaryAction", async ({ slotA, slotB, skip }, callback) => {
        const { userId, code, isSpectator } = socket.data;

        if (isSpectator) {
            callback({ success: false, error: "Spectators cannot perform actions" });
            return;
        }
        if (!code) {
            callback({ success: false, error: "Not in an active game" });
            return;
        }

        const state = await getGameState<GameState>(code);
        if (!state) {
            callback({ success: false, error: "Game state not found" });
            return;
        }
        if (state.phase !== "SPECIAL_ACTIONS") {
            callback({ success: false, error: "Not in SPECIAL_ACTIONS phase" });
            return;
        }

        const current = state.pendingSpecialActions[0];
        if (!current || current.userId !== userId || current.type !== "apothecary") {
            callback({ success: false, error: "Not your turn to perform an apothecary action" });
            return;
        }

        let currentState = state;

        if (!skip) {
            if (!slotA || !slotB) {
                callback({ success: false, error: "Must provide both slotA and slotB" });
                return;
            }
            const result = engine.applyApothecaryAction(state, userId, slotA, slotB);
            if ("error" in result) {
                callback({ success: false, error: result.error });
                return;
            }
            currentState = result.newState;
        }

        // Pop the completed action off the queue
        currentState = {
            ...currentState,
            pendingSpecialActions: currentState.pendingSpecialActions.slice(1),
        };

        // If the queue is empty, advance the round
        const nextState =
            currentState.pendingSpecialActions.length === 0
                ? engine.advanceAfterSpecialActions(currentState)
                : currentState;

        await setGameState(code, nextState);
        callback({ success: true });
        io.to(`game:${code}`).emit("game:stateUpdate", nextState);

        await finalizeGameIfOver(code, nextState, io);
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

    // Handle GAME_OVER (can happen if no special actions and board is now full)
    await finalizeGameIfOver(code, newState, io);

    // SPECIAL_ACTIONS and ROUND_OVER are handled by subsequent client events
    // (game:spyAction, game:apothecaryAction, game:resultsAck)
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
