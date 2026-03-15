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
import type { GameState, RoundSnapshot, CompletedSpecialAction } from "./types.js";
import type {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData,
} from "./types.js";
import { BID_SPACES } from "../game/blocks.js";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ── Disconnect Timers ──────────────────────────────────────────────────────────
// Keyed by "${code}:${userId}". When a player disconnects, we give them 60 seconds
// to reconnect before closing the entire game.
// In-memory is acceptable: if the server crashes, the game is gone anyway.
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// ── Auto-play Timers ───────────────────────────────────────────────────────────
// DEV ONLY. Keyed by game code. Bots advance the game state automatically.
const autoPlayTimers = new Map<string, NodeJS.Timeout>();

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

    // Cancel any running auto-play loop
    const autoTimer = autoPlayTimers.get(code);
    if (autoTimer) {
        clearTimeout(autoTimer);
        autoPlayTimers.delete(code);
    }

    // Delete the game state and round history from Redis
    await Promise.all([deleteGameState(code), redis.del(keys.roundHistory(code))]);

    // Notify all players — they'll navigate to "/"
    io.to(`game:${code}`).emit("game:closed", { reason });
}

// ── appendRoundHistory ─────────────────────────────────────────────────────────
// Appends a snapshot of the just-completed round to Redis.
// Called whenever the phase transitions to ROUND_OVER or GAME_OVER.
// The full history is read and saved to Postgres when saveCompletedGame runs.
async function appendRoundHistory(code: string, state: GameState): Promise<void> {
    const snapshot: RoundSnapshot = {
        roundNumber: state.roundNumber,
        results: state.lastRoundResults ?? [],
        specialActions: state.completedSpecialActions ?? [],
        boardLocations: state.boardLocations,
        playerScores: state.players.map((p) => ({
            userId: p.userId,
            username: p.username,
            score: p.score,
        })),
    };
    const raw = await redis.get(keys.roundHistory(code));
    const history: RoundSnapshot[] = raw ? JSON.parse(raw) : [];
    history.push(snapshot);
    await redis.set(keys.roundHistory(code), JSON.stringify(history), "EX", 86400);
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

        // Build the history record for this action
        const actionRecord: CompletedSpecialAction = {
            type: "spy",
            userId,
            username: current.username,
            skipped: !!skip,
        };

        if (!skip) {
            if (locationId === undefined || slotIndex === undefined) {
                callback({ success: false, error: "Must provide locationId and slotIndex" });
                return;
            }
            // Capture who is being displaced before the swap
            const targetLoc = state.boardLocations.find((l) => l.locationId === locationId);
            const targetSlot = targetLoc?.slots[slotIndex];
            if (targetSlot?.occupiedBy) {
                actionRecord.spyTarget = {
                    locationId,
                    slotIndex,
                    previousUserId: targetSlot.occupiedBy,
                    previousUsername: targetSlot.occupiedByUsername ?? targetSlot.occupiedBy,
                };
            }
            const result = engine.applySpyAction(state, userId, locationId, slotIndex);
            if ("error" in result) {
                callback({ success: false, error: result.error });
                return;
            }
            currentState = result.newState;
        }

        // Pop the completed action off the queue and record it
        currentState = {
            ...currentState,
            pendingSpecialActions: currentState.pendingSpecialActions.slice(1),
            completedSpecialActions: [...(currentState.completedSpecialActions ?? []), actionRecord],
        };

        // If the queue is empty, advance the round
        const nextState =
            currentState.pendingSpecialActions.length === 0
                ? engine.advanceAfterSpecialActions(currentState)
                : currentState;

        // Append round history snapshot when the round is fully resolved
        if (nextState.phase === "ROUND_OVER" || nextState.phase === "GAME_OVER") {
            await appendRoundHistory(code, nextState);
        }

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

        // Build the history record for this action
        const actionRecord: CompletedSpecialAction = {
            type: "apothecary",
            userId,
            username: current.username,
            skipped: !!skip,
        };

        if (!skip) {
            if (!slotA || !slotB) {
                callback({ success: false, error: "Must provide both slotA and slotB" });
                return;
            }
            // Capture the owners before the swap
            const locA = state.boardLocations.find((l) => l.locationId === slotA.locationId);
            const locB = state.boardLocations.find((l) => l.locationId === slotB.locationId);
            const sA = locA?.slots[slotA.slotIndex];
            const sB = locB?.slots[slotB.slotIndex];
            if (sA?.occupiedBy && sB?.occupiedBy) {
                actionRecord.apothecarySwap = {
                    slotA: { ...slotA, userId: sA.occupiedBy, username: sA.occupiedByUsername ?? sA.occupiedBy },
                    slotB: { ...slotB, userId: sB.occupiedBy, username: sB.occupiedByUsername ?? sB.occupiedBy },
                };
            }
            const result = engine.applyApothecaryAction(state, userId, slotA, slotB);
            if ("error" in result) {
                callback({ success: false, error: result.error });
                return;
            }
            currentState = result.newState;
        }

        // Pop the completed action off the queue and record it
        currentState = {
            ...currentState,
            pendingSpecialActions: currentState.pendingSpecialActions.slice(1),
            completedSpecialActions: [...(currentState.completedSpecialActions ?? []), actionRecord],
        };

        // If the queue is empty, advance the round
        const nextState =
            currentState.pendingSpecialActions.length === 0
                ? engine.advanceAfterSpecialActions(currentState)
                : currentState;

        // Append round history snapshot when the round is fully resolved
        if (nextState.phase === "ROUND_OVER" || nextState.phase === "GAME_OVER") {
            await appendRoundHistory(code, nextState);
        }

        await setGameState(code, nextState);
        callback({ success: true });
        io.to(`game:${code}`).emit("game:stateUpdate", nextState);

        await finalizeGameIfOver(code, nextState, io);
    });

    // ── game:leave ─────────────────────────────────────────────────────────────
    // Player explicitly leaves the game (navigated away within the SPA).
    // Starts the same 60s reconnect timer as a socket disconnect,
    // UNLESS the game is already over — no point reconnecting to a finished game.
    socket.on("game:leave", async () => {
        const { code, userId, username } = socket.data;
        if (!code || socket.data.isSpectator) return;

        // Clear their "current game" tracking — they intentionally left
        redis.del(keys.playerCurrent(userId));

        // Leave the room
        socket.leave(`game:${code}`);
        socket.data.code = undefined;

        // Don't start a rejoin timer when the game is already finished
        const state = await getGameState<GameState>(code);
        if (state?.phase === "GAME_OVER") return;

        startDisconnectTimer(code, userId, username, io);
    });

    // ── DEV ONLY: dev:skipToEnd ────────────────────────────────────────────────
    // Fills every empty board slot round-robin among players, awards majority
    // support, then jumps to GAME_OVER. Only registered outside production.
    if (process.env.NODE_ENV !== "production") {
        socket.on("dev:skipToEnd", async (callback) => {
            const { code } = socket.data;
            if (!code) return callback({ success: false, error: "Not in a game" });

            const state = await getGameState<GameState>(code);
            if (!state) return callback({ success: false, error: "No game state found" });
            if (state.phase === "GAME_OVER") return callback({ success: false, error: "Game already over" });

            // Deep-clone so we can mutate freely
            const s: GameState = JSON.parse(JSON.stringify(state));

            // Fill every empty slot round-robin across all players
            let pIdx = 0;
            for (const loc of s.boardLocations) {
                for (const slot of loc.slots) {
                    if (!slot.occupiedBy) {
                        const p = s.players[pIdx % s.players.length];
                        slot.occupiedBy = p.userId;
                        slot.occupiedByUsername = p.username;
                        pIdx++;
                    }
                }
            }

            // Award end-game majority support per location
            for (const loc of s.boardLocations) {
                const counts: Record<string, number> = {};
                for (const slot of loc.slots) {
                    if (slot.occupiedBy) counts[slot.occupiedBy] = (counts[slot.occupiedBy] ?? 0) + 1;
                }
                const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                if (sorted.length > 0 && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) {
                    const winner = s.players.find((p) => p.userId === sorted[0][0]);
                    if (winner) winner.score += loc.endGameSupport;
                }
            }

            // Determine overall winner
            const topPlayer = s.players.reduce((a, b) => (a.score > b.score ? a : b));
            const finalState: GameState = {
                ...s,
                phase: "GAME_OVER",
                winner: topPlayer.userId,
                pendingSpecialActions: [],
            };

            await setGameState(code, finalState);
            io.to(`game:${code}`).emit("game:stateUpdate", finalState);
            callback({ success: true });
        });

        // ── DEV ONLY: dev:autoPlay ─────────────────────────────────────────────
        // Starts a bot loop that auto-advances the game through every phase at
        // ~600ms intervals. Bots submit random (but valid) bids, skip special
        // actions, and auto-ack round results until GAME_OVER.
        socket.on("dev:autoPlay", (callback) => {
            const { code } = socket.data;
            if (!code) return callback({ success: false, error: "Not in a game" });
            if (autoPlayTimers.has(code)) return callback({ success: false, error: "Auto-play already running" });

            const scheduleNext = () => {
                const timer = setTimeout(() => runStep(code, io), 600);
                autoPlayTimers.set(code, timer);
            };
            scheduleNext();
            callback({ success: true });
        });

        // ── DEV ONLY: dev:stopAutoPlay ─────────────────────────────────────────
        socket.on("dev:stopAutoPlay", (callback) => {
            const { code } = socket.data;
            if (!code) return callback({ success: false, error: "Not in a game" });
            const timer = autoPlayTimers.get(code);
            if (timer) {
                clearTimeout(timer);
                autoPlayTimers.delete(code);
            }
            callback({ success: true });
        });
    }
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

    // Append round history when going directly to ROUND_OVER or GAME_OVER
    // (i.e. no special actions this round). Spy/apothecary handlers do their own append.
    if (newState.phase === "ROUND_OVER" || newState.phase === "GAME_OVER") {
        await appendRoundHistory(code, newState);
    }

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
// roundHistory is read from Redis and included as a JSON array of RoundSnapshot objects.
async function saveCompletedGame(code: string, finalState: GameState): Promise<void> {
    const raw = await redis.get(keys.roundHistory(code));
    const roundHistory: RoundSnapshot[] = raw ? JSON.parse(raw) : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.completedGame as any).create({
        data: {
            code,
            durationMs: 0, // placeholder — add startedAt to GameState to calculate properly
            finalState: finalState as object,
            roundHistory: roundHistory as object,
        },
    });
}

// ── Auto-play helpers (DEV ONLY) ───────────────────────────────────────────────

// Distribute a player's tokens randomly across at most 6 valid bid spaces.
// Guarantees at least one active space accepts each token type the player holds.
// Respects noForce / noBlackmail restrictions. All tokens must be spent.
function generateRandomBids(player: GameState["players"][number]): import("./types.js").BidSubmission[] {
    const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
    const pick    = <T>(arr: T[]): T   => arr[Math.floor(Math.random() * arr.length)];

    const allSpaces       = BID_SPACES.map((s) => s.id);
    const blackmailSpaces = BID_SPACES.filter((s) => !s.noBlackmail).map((s) => s.id);
    const forceSpaces     = BID_SPACES.filter((s) => !s.noForce).map((s) => s.id);

    // Seed the active set with at least one space for each token type held
    const seeded = new Set<string>();
    if (player.blackmailTokens > 0) seeded.add(pick(blackmailSpaces));
    if (player.forceTokens     > 0) seeded.add(pick(forceSpaces));

    // Fill up to 6 active spaces from a shuffled pool
    const pool = shuffle(allSpaces.filter((id) => !seeded.has(id)));
    for (const id of pool) {
        if (seeded.size >= 6) break;
        seeded.add(id);
    }

    // Only scatter tokens within the active set (with per-type restrictions)
    const activeBlackmail = blackmailSpaces.filter((id) => seeded.has(id));
    const activeForce     = forceSpaces.filter((id) => seeded.has(id));
    const activeGold      = allSpaces.filter((id) => seeded.has(id));

    const bids: Record<string, { gold: number; blackmail: number; force: number }> = {};
    for (const s of BID_SPACES) bids[s.id] = { gold: 0, blackmail: 0, force: 0 };

    for (let i = 0; i < player.goldTokens;      i++) bids[pick(activeGold)].gold++;
    for (let i = 0; i < player.blackmailTokens; i++) bids[pick(activeBlackmail)].blackmail++;
    for (let i = 0; i < player.forceTokens;     i++) bids[pick(activeForce)].force++;

    return BID_SPACES.map((s) => ({ blockId: s.id, ...bids[s.id] }));
}

// Handle one auto-play step for the current phase, then reschedule.
async function runStep(code: string, io: AppServer): Promise<void> {
    // If the timer was cancelled (e.g. game closed), stop silently
    if (!autoPlayTimers.has(code)) return;

    const state = await getGameState<GameState>(code);
    if (!state || state.phase === "GAME_OVER") {
        autoPlayTimers.delete(code);
        return;
    }

    if (state.phase === "BID_PHASE") {
        // Store random bids in Redis for every player who hasn't submitted yet
        let updatedState = state;
        for (const player of state.players.filter((p) => p.isConnected && !p.hasSubmittedBids)) {
            const bids = generateRandomBids(player);
            await redis.set(keys.pendingBids(code, player.userId), JSON.stringify(bids), "EX", 3600);
            updatedState = engine.markBidsSubmitted(updatedState, player.userId);
        }
        await setGameState(code, updatedState);
        io.to(`game:${code}`).emit("game:stateUpdate", updatedState);
        // resolveRound will emit its own stateUpdate and handle history/finalize
        await resolveRound(code, io);

    } else if (state.phase === "SPECIAL_ACTIONS") {
        // Auto-skip the current pending special action
        const current = state.pendingSpecialActions[0];
        if (!current) return;

        const skipRecord: CompletedSpecialAction = {
            type: current.type,
            userId: current.userId,
            username: current.username,
            skipped: true,
        };

        let nextState: GameState = {
            ...state,
            pendingSpecialActions: state.pendingSpecialActions.slice(1),
            completedSpecialActions: [...(state.completedSpecialActions ?? []), skipRecord],
        };

        if (nextState.pendingSpecialActions.length === 0) {
            nextState = engine.advanceAfterSpecialActions(nextState);
        }

        if (nextState.phase === "ROUND_OVER" || nextState.phase === "GAME_OVER") {
            await appendRoundHistory(code, nextState);
        }

        await setGameState(code, nextState);
        io.to(`game:${code}`).emit("game:stateUpdate", nextState);
        await finalizeGameIfOver(code, nextState, io);

    } else if (state.phase === "ROUND_OVER") {
        // Auto-ack for all connected players
        let updatedState = state;
        for (const player of state.players.filter((p) => p.isConnected)) {
            updatedState = engine.ackResults(updatedState, player.userId);
        }
        const allAcked = updatedState.players
            .filter((p) => p.isConnected)
            .every((p) => updatedState.resultsAckUserIds.includes(p.userId));

        if (allAcked) {
            const nextRound = engine.startNextRound(updatedState);
            await setGameState(code, nextRound);
            io.to(`game:${code}`).emit("game:stateUpdate", nextRound);
        } else {
            await setGameState(code, updatedState);
            io.to(`game:${code}`).emit("game:stateUpdate", updatedState);
        }
    }

    // Reschedule the next step (if still running and not game over)
    const freshState = await getGameState<GameState>(code);
    if (freshState && freshState.phase !== "GAME_OVER" && autoPlayTimers.has(code)) {
        const timer = setTimeout(() => runStep(code, io), 600);
        autoPlayTimers.set(code, timer);
    } else {
        autoPlayTimers.delete(code);
    }
}
