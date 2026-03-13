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
//
// ── Game End Condition ────────────────────────────────────────────────────────
// The game ends when every influence slot on the board is filled.
// The round where this happens still plays out fully (including spy/apothecary
// special actions), then the game ends.
// At game end, the player with the most blocks in each location earns that
// location's end-game support bonus. Tied majority → nobody earns the bonus.

import type { GameState, BidSubmission, BlockResult, InfluenceSlot } from "../socket/types.js";
import {
    BID_SPACES,
    BID_SPACE_MAP,
    BOARD_LOCATIONS,
    STARTING_TOKENS,
} from "./blocks.js";

// ── isBoardFull ────────────────────────────────────────────────────────────────
// Returns true when every influence slot on the board is occupied.
function isBoardFull(boardLocations: GameState["boardLocations"]): boolean {
    return boardLocations.every((loc) => loc.slots.every((slot) => slot.occupiedBy !== null));
}

// ── awardMajoritySupport ───────────────────────────────────────────────────────
// Adds end-game location bonuses to a mutable scores map.
// Called once at game end after all special actions complete.
function awardMajoritySupport(
    boardLocations: GameState["boardLocations"],
    scores: Record<string, number>
): void {
    for (const loc of boardLocations) {
        const counts: Record<string, number> = {};
        for (const slot of loc.slots) {
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

        // Tied majority → nobody earns the bonus
        if (majority && !tied && scores[majority] !== undefined) {
            scores[majority] += loc.endGameSupport;
        }
    }
}

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
        resultsAckUserIds: [],
        winner: null,
        pendingSpecialActions: [],
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
//
// After resolution:
//   - If spy or apothecary were won, enter SPECIAL_ACTIONS phase so the
//     winners can choose which cubes to replace/swap.
//   - If no special actions, advance via advanceAfterSpecialActions()
//     which checks board fullness to decide ROUND_OVER vs GAME_OVER.
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

    const updatedPlayers = state.players.map((p) => ({
        ...p,
        ...playerUpdates[p.userId],
    }));

    const updatedLocations = state.boardLocations.map((loc) => ({
        ...loc,
        slots: locationSlots[loc.locationId] ?? loc.slots,
    }));

    // Collect pending special actions (spy and apothecary winners, in board order)
    const pendingSpecialActions: GameState["pendingSpecialActions"] = results
        .filter((r) => r.special !== null && r.winnerUserId !== null)
        .map((r) => ({
            type: r.special as "spy" | "apothecary",
            userId: r.winnerUserId!,
            username: r.winnerUsername!,
        }));

    // Build the intermediate state after regular resolution
    const intermediateState: GameState = {
        ...state,
        players: updatedPlayers,
        boardLocations: updatedLocations,
        lastRoundResults: results,
        resultsAckUserIds: [],
        winner: null,
        pendingSpecialActions,
    };

    // Determine the phase to enter
    let newState: GameState;
    if (pendingSpecialActions.length > 0) {
        // Spy/apothecary winners must act before the round concludes
        newState = { ...intermediateState, phase: "SPECIAL_ACTIONS" };
    } else {
        // No special actions — transition directly to ROUND_OVER or GAME_OVER
        newState = advanceAfterSpecialActions(intermediateState);
    }

    return { newState, results };
}

// ── advanceAfterSpecialActions ─────────────────────────────────────────────────
// Called when the pendingSpecialActions queue drains to zero.
// Checks board fullness: full → award majority support and GAME_OVER,
// otherwise → ROUND_OVER.
function advanceAfterSpecialActions(state: GameState): GameState {
    if (!isBoardFull(state.boardLocations)) {
        return { ...state, phase: "ROUND_OVER" };
    }

    // Board is full — award end-game majority support bonuses
    const scores: Record<string, number> = {};
    for (const p of state.players) {
        scores[p.userId] = p.score;
    }
    awardMajoritySupport(state.boardLocations, scores);

    const updatedPlayers = state.players.map((p) => ({
        ...p,
        score: scores[p.userId] ?? p.score,
    }));

    const winner = updatedPlayers.reduce((a, b) => (a.score > b.score ? a : b));

    return {
        ...state,
        phase: "GAME_OVER",
        players: updatedPlayers,
        winner: winner.userId,
    };
}

// ── applySpyAction ─────────────────────────────────────────────────────────────
// The spy winner picks one opponent's occupied slot and replaces it with
// their own cube.
// Returns the new state, or an error string if the action is invalid.
function applySpyAction(
    state: GameState,
    actingUserId: string,
    locationId: string,
    slotIndex: number
): { newState: GameState } | { error: string } {
    const loc = state.boardLocations.find((l) => l.locationId === locationId);
    if (!loc) return { error: "Invalid location" };

    const slot = loc.slots[slotIndex];
    if (!slot) return { error: "Invalid slot index" };
    if (slot.occupiedBy === null) return { error: "Slot is empty — you must replace an opponent's cube" };
    if (slot.occupiedBy === actingUserId) return { error: "Cannot replace your own cube" };

    const actingPlayer = state.players.find((p) => p.userId === actingUserId);
    if (!actingPlayer) return { error: "Acting player not found" };

    const newLocations = state.boardLocations.map((l) => {
        if (l.locationId !== locationId) return l;
        return {
            ...l,
            slots: l.slots.map((s, i) => {
                if (i !== slotIndex) return s;
                return {
                    ...s,
                    occupiedBy: actingUserId,
                    occupiedByUsername: actingPlayer.username,
                };
            }),
        };
    });

    return { newState: { ...state, boardLocations: newLocations } };
}

// ── applyApothecaryAction ──────────────────────────────────────────────────────
// The apothecary winner picks two occupied slots and swaps their cubes.
// Both slots must be occupied (by any player). The winner can include their
// own cubes in the swap.
function applyApothecaryAction(
    state: GameState,
    _actingUserId: string,
    slotA: { locationId: string; slotIndex: number },
    slotB: { locationId: string; slotIndex: number }
): { newState: GameState } | { error: string } {
    if (slotA.locationId === slotB.locationId && slotA.slotIndex === slotB.slotIndex) {
        return { error: "Must pick two different slots" };
    }

    const locA = state.boardLocations.find((l) => l.locationId === slotA.locationId);
    const locB = state.boardLocations.find((l) => l.locationId === slotB.locationId);
    if (!locA || !locB) return { error: "Invalid location" };

    const sA = locA.slots[slotA.slotIndex];
    const sB = locB.slots[slotB.slotIndex];
    if (!sA || !sB) return { error: "Invalid slot index" };
    if (sA.occupiedBy === null || sB.occupiedBy === null) {
        return { error: "Both slots must be occupied" };
    }

    // Swap the two cubes
    const newLocations = state.boardLocations.map((loc) => ({
        ...loc,
        slots: loc.slots.map((s, i) => {
            if (loc.locationId === slotA.locationId && i === slotA.slotIndex) {
                return { ...s, occupiedBy: sB.occupiedBy, occupiedByUsername: sB.occupiedByUsername };
            }
            if (loc.locationId === slotB.locationId && i === slotB.slotIndex) {
                return { ...s, occupiedBy: sA.occupiedBy, occupiedByUsername: sA.occupiedByUsername };
            }
            return s;
        }),
    }));

    return { newState: { ...state, boardLocations: newLocations } };
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
        resultsAckUserIds: [],
        pendingSpecialActions: [],
    };
}

// ── ackResults ─────────────────────────────────────────────────────────────────
// Records that a player has acknowledged the round results.
function ackResults(state: GameState, userId: string): GameState {
    if (state.resultsAckUserIds.includes(userId)) return state;
    return {
        ...state,
        resultsAckUserIds: [...state.resultsAckUserIds, userId],
    };
}

export const engine = {
    createInitialState,
    validateBids,
    markBidsSubmitted,
    resolveRound,
    ackResults,
    startNextRound,
    applySpyAction,
    applyApothecaryAction,
    advanceAfterSpecialActions,
};
