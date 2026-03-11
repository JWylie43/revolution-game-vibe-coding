// game/engine.ts
//
// The game engine — ALL Revolution game rules live here.
//
// ── Design Principle: Pure Functions ─────────────────────────────────────────
// Every function in this file takes state IN and returns new state OUT.
// No side effects: no database calls, no Redis, no Socket.io, no HTTP.
//
// The Socket.io handlers call these functions and then handle the I/O
// (saving to Redis, emitting events). This file just does the math.

import type { GameState, BidSubmission, BlockResult, InfluenceSlot } from "../socket/types.js";
import {
    BID_SPACES,
    BID_SPACE_MAP,
    BOARD_LOCATIONS,
    TOTAL_ROUNDS,
    STARTING_TOKENS,
} from "./blocks.js";

// ── createInitialState ─────────────────────────────────────────────────────────
// Builds the starting game state. Called once when a game begins.
function createInitialState(
    gameId: string,
    players: Array<{ userId: string; username: string; seatNumber: number }>
): GameState {
    return {
        gameId,
        phase: "BID_PHASE",
        roundNumber: 1,
        roundEndTime: Date.now() + 90_000,
        players: players.map((p) => ({
            userId: p.userId,
            username: p.username,
            seatNumber: p.seatNumber,
            score: 0,
            goldTokens: STARTING_TOKENS.gold,
            blackmailTokens: STARTING_TOKENS.blackmail,
            forceTokens: STARTING_TOKENS.force,
            hasSubmittedBids: false,
            isConnected: true,
        })),
        boardLocations: BOARD_LOCATIONS.map((loc) => ({
            locationId: loc.id,
            locationName: loc.name,
            endGameSupport: loc.endGameSupport,
            slots: Array.from<unknown, InfluenceSlot>({ length: loc.slots }, (_, i) => ({
                slotIndex: i,
                occupiedBy: null,
                occupiedByUsername: null,
            })),
        })),
        lastRoundResults: null,
        winner: null,
    };
}

// ── validateBids ───────────────────────────────────────────────────────────────
// Checks that a player's submitted bids are legal.
function validateBids(
    bids: BidSubmission[],
    playerState: GameState["players"][number]
): { valid: true } | { valid: false; error: string } {
    let totalGold = 0;
    let totalBlackmail = 0;
    let totalForce = 0;

    const seen = new Set<string>();

    for (const bid of bids) {
        const space = BID_SPACE_MAP[bid.blockId];
        if (!space) {
            return { valid: false, error: `Unknown bid space: ${bid.blockId}` };
        }
        if (seen.has(bid.blockId)) {
            return { valid: false, error: `Duplicate bid for: ${bid.blockId}` };
        }
        seen.add(bid.blockId);

        if (bid.gold < 0 || bid.blackmail < 0 || bid.force < 0) {
            return { valid: false, error: "Bid amounts cannot be negative" };
        }
        if (!Number.isInteger(bid.gold) || !Number.isInteger(bid.blackmail) || !Number.isInteger(bid.force)) {
            return { valid: false, error: "Bid amounts must be whole numbers" };
        }

        // Bid restrictions per space
        if (space.noForce && bid.force > 0) {
            return { valid: false, error: `Cannot bid Force on ${space.name}` };
        }
        if (space.noBlackmail && bid.blackmail > 0) {
            return { valid: false, error: `Cannot bid Blackmail on ${space.name}` };
        }

        totalGold += bid.gold;
        totalBlackmail += bid.blackmail;
        totalForce += bid.force;
    }

    if (totalGold > playerState.goldTokens) {
        return { valid: false, error: `Not enough gold (have ${playerState.goldTokens}, spending ${totalGold})` };
    }
    if (totalBlackmail > playerState.blackmailTokens) {
        return { valid: false, error: `Not enough blackmail (have ${playerState.blackmailTokens}, spending ${totalBlackmail})` };
    }
    if (totalForce > playerState.forceTokens) {
        return { valid: false, error: `Not enough force (have ${playerState.forceTokens}, spending ${totalForce})` };
    }

    // All tokens must be spent — no hoarding
    if (totalGold < playerState.goldTokens) {
        return { valid: false, error: `Must spend all gold tokens (${playerState.goldTokens - totalGold} unspent)` };
    }
    if (totalBlackmail < playerState.blackmailTokens) {
        return { valid: false, error: `Must spend all blackmail tokens (${playerState.blackmailTokens - totalBlackmail} unspent)` };
    }
    if (totalForce < playerState.forceTokens) {
        return { valid: false, error: `Must spend all force tokens (${playerState.forceTokens - totalForce} unspent)` };
    }

    return { valid: true };
}

// ── markBidsSubmitted ──────────────────────────────────────────────────────────
function markBidsSubmitted(state: GameState, userId: string): GameState {
    return {
        ...state,
        players: state.players.map((p) =>
            p.userId === userId ? { ...p, hasSubmittedBids: true } : p
        ),
    };
}

// ── resolveRound ───────────────────────────────────────────────────────────────
// Resolve all bids, award rewards, place influence blocks, and update scores.
//
// Bid winner determination:
//   - Highest total (gold + blackmail + force) wins
//   - Ties broken by: force first, then blackmail, then gold
//   - Perfect tie (all amounts identical) = nobody wins the space
function resolveRound(
    state: GameState,
    allBids: Record<string, unknown[]>
): { newState: GameState; results: BlockResult[] } {
    const results: BlockResult[] = [];

    // Start each player with base token allocation (bonuses add on top)
    const playerUpdates: Record<string, {
        score: number;
        goldTokens: number;
        blackmailTokens: number;
        forceTokens: number;
        hasSubmittedBids: boolean;
    }> = {};
    for (const p of state.players) {
        playerUpdates[p.userId] = {
            score: p.score,
            goldTokens: STARTING_TOKENS.gold,
            blackmailTokens: STARTING_TOKENS.blackmail,
            forceTokens: STARTING_TOKENS.force,
            hasSubmittedBids: false,
        };
    }

    // Deep-copy board locations so we can mutate slots
    const locationSlots: Record<string, InfluenceSlot[]> = {};
    for (const loc of state.boardLocations) {
        locationSlots[loc.locationId] = loc.slots.map((s) => ({ ...s }));
    }

    // Process each bid space in board order
    for (const space of BID_SPACES) {
        const bidsForSpace: Array<{
            userId: string; username: string;
            gold: number; blackmail: number; force: number;
        }> = [];

        for (const player of state.players) {
            const playerBids = allBids[player.userId] as BidSubmission[] | undefined;
            if (!playerBids) continue;
            const bid = playerBids.find((b) => b.blockId === space.id);
            if (bid && (bid.gold + bid.blackmail + bid.force > 0)) {
                bidsForSpace.push({
                    userId: player.userId,
                    username: player.username,
                    gold: bid.gold,
                    blackmail: bid.blackmail,
                    force: bid.force,
                });
            }
        }

        // Determine winner
        let winner: (typeof bidsForSpace)[number] | null = null;

        if (bidsForSpace.length > 0) {
            const scored = bidsForSpace
                .map((b) => ({ ...b, total: b.gold + b.blackmail + b.force }))
                .sort((a, b) => {
                    if (b.total !== a.total) return b.total - a.total;
                    if (b.force !== a.force) return b.force - a.force;
                    if (b.blackmail !== a.blackmail) return b.blackmail - a.blackmail;
                    return b.gold - a.gold;
                });

            const [top, second] = scored;
            const tied =
                second !== undefined &&
                top.total === second.total &&
                top.force === second.force &&
                top.blackmail === second.blackmail &&
                top.gold === second.gold;

            if (!tied) winner = top;
        }

        if (winner) {
            const r = space.rewards;
            const u = playerUpdates[winner.userId];

            // Award direct support
            u.score += r.support;

            // Award tokens (added on top of the base allocation)
            u.goldTokens += r.gold;
            u.blackmailTokens += r.blackmail;
            u.forceTokens += r.force;

            // Place influence block — find the first empty slot in the target location
            if (r.influenceLocation) {
                const slots = locationSlots[r.influenceLocation];
                if (slots) {
                    const emptyIdx = slots.findIndex((s) => s.occupiedBy === null);
                    if (emptyIdx !== -1) {
                        slots[emptyIdx] = {
                            ...slots[emptyIdx],
                            occupiedBy: winner.userId,
                            occupiedByUsername: winner.username,
                        };
                    }
                }
            }

            // Special actions (Spy and Apothecary require player interaction — deferred to later phase)
            // For now these are noted in the result but not auto-applied.
        }

        results.push({
            blockId: space.id,
            winnerUserId: winner?.userId ?? null,
            winnerUsername: winner?.username ?? null,
            support: winner ? space.rewards.support : 0,
            gold: winner ? space.rewards.gold : 0,
            blackmail: winner ? space.rewards.blackmail : 0,
            force: winner ? space.rewards.force : 0,
            influenceLocationId: winner ? space.rewards.influenceLocation : null,
            special: winner ? space.rewards.special : null,
            bids: bidsForSpace,
        });
    }

    const isGameOver = state.roundNumber >= TOTAL_ROUNDS;

    // On the last round, award end-game majority support per location
    if (isGameOver) {
        for (const loc of state.boardLocations) {
            const slots = locationSlots[loc.locationId];
            const counts: Record<string, number> = {};
            for (const slot of slots) {
                if (slot.occupiedBy) {
                    counts[slot.occupiedBy] = (counts[slot.occupiedBy] ?? 0) + 1;
                }
            }

            let maxCount = 0;
            let majority: string | null = null;
            let tied = false;
            for (const [uid, count] of Object.entries(counts)) {
                if (count > maxCount) {
                    maxCount = count;
                    majority = uid;
                    tied = false;
                } else if (count === maxCount) {
                    tied = true;
                }
            }

            // Tied majority = nobody earns the bonus
            if (majority && !tied) {
                playerUpdates[majority].score += loc.endGameSupport;
            }
        }
    }

    const updatedPlayers = state.players.map((p) => ({
        ...p,
        ...playerUpdates[p.userId],
    }));

    const updatedLocations = state.boardLocations.map((loc) => ({
        ...loc,
        slots: locationSlots[loc.locationId] ?? loc.slots,
    }));

    const newState: GameState = {
        ...state,
        phase: isGameOver ? "GAME_OVER" : "ROUND_OVER",
        players: updatedPlayers,
        boardLocations: updatedLocations,
        lastRoundResults: results,
        winner: isGameOver
            ? updatedPlayers.reduce((a, b) => (a.score > b.score ? a : b)).userId
            : null,
    };

    return { newState, results };
}

// ── startNextRound ─────────────────────────────────────────────────────────────
// Transitions from ROUND_OVER → BID_PHASE for the next round.
function startNextRound(state: GameState): GameState {
    return {
        ...state,
        phase: "BID_PHASE",
        roundNumber: state.roundNumber + 1,
        roundEndTime: Date.now() + 90_000,
        lastRoundResults: null,
    };
}

export const engine = {
    createInitialState,
    validateBids,
    markBidsSubmitted,
    resolveRound,
    startNextRound,
};
