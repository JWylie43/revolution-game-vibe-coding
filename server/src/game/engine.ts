// game/engine.ts
//
// The game engine — ALL Revolution game rules live here.
//
// ── Design Principle: Pure Functions ─────────────────────────────────────────
// Every function in this file takes state IN and returns new state OUT.
// No side effects: no database calls, no Redis, no Socket.io, no HTTP.
//
// WHY: Pure functions are:
//   1. Testable — you can call them with mock data without any infrastructure
//   2. Predictable — same input always produces same output
//   3. Easy to reason about — no hidden state changes
//
// The Socket.io handlers call these functions and then handle the I/O
// (saving to Redis, emitting events). This file just does the math.
//
// Think of it like this:
//   - engine.ts = the chess rules book
//   - gameHandler.ts = the chess clock and referee

import type { GameState, BidSubmission, BlockResult } from "../socket/types.js";
import { BLOCKS, BLOCK_MAP, TOTAL_ROUNDS, STARTING_TOKENS } from "./blocks.js";

// ── createInitialState ─────────────────────────────────────────────────────────
// Builds the starting game state. Called once when a game begins.
// Takes a gameId and list of players; returns the initial GameState.
function createInitialState(
  gameId: string,
  players: Array<{ userId: string; username: string; seatNumber: number }>
): GameState {
  return {
    gameId,
    phase: "BID_PHASE",
    roundNumber: 1,
    // Round ends in 90 seconds from now
    roundEndTime: Date.now() + 90_000,
    players: players.map((p) => ({
      userId: p.userId,
      username: p.username,
      seatNumber: p.seatNumber,
      score: 0,
      // Starting token allocation
      goldTokens: STARTING_TOKENS.gold,
      blackmailTokens: STARTING_TOKENS.blackmail,
      forceTokens: STARTING_TOKENS.force,
      hasSubmittedBids: false,
      isConnected: true,
    })),
    board: BLOCKS.map((block) => ({
      blockId: block.id,
      blockName: block.name,
      controlledBy: null, // Nobody controls anything at start
      pointValue: block.supportPoints,
    })),
    lastRoundResults: null,
    winner: null,
  };
}

// ── validateBids ───────────────────────────────────────────────────────────────
// Checks that a player's submitted bids are legal.
// Returns { valid: true } or { valid: false, error: "..." }
function validateBids(
  bids: BidSubmission[],
  playerState: GameState["players"][number]
): { valid: true } | { valid: false; error: string } {
  // Count total tokens being spent across all bids
  let totalGold = 0;
  let totalBlackmail = 0;
  let totalForce = 0;

  const bidBlockIds = new Set<string>();

  for (const bid of bids) {
    // Check that the block exists
    if (!BLOCK_MAP[bid.blockId]) {
      return { valid: false, error: `Unknown block: ${bid.blockId}` };
    }

    // No duplicate block bids
    if (bidBlockIds.has(bid.blockId)) {
      return { valid: false, error: `Duplicate bid for block: ${bid.blockId}` };
    }
    bidBlockIds.add(bid.blockId);

    // Bid amounts must be non-negative integers
    if (bid.gold < 0 || bid.blackmail < 0 || bid.force < 0) {
      return { valid: false, error: "Bid amounts cannot be negative" };
    }

    // Must be whole numbers (no bidding 1.5 gold)
    if (!Number.isInteger(bid.gold) || !Number.isInteger(bid.blackmail) || !Number.isInteger(bid.force)) {
      return { valid: false, error: "Bid amounts must be whole numbers" };
    }

    totalGold += bid.gold;
    totalBlackmail += bid.blackmail;
    totalForce += bid.force;
  }

  // Can't spend more tokens than you have
  if (totalGold > playerState.goldTokens) {
    return { valid: false, error: `Not enough gold tokens (have ${playerState.goldTokens}, spending ${totalGold})` };
  }
  if (totalBlackmail > playerState.blackmailTokens) {
    return { valid: false, error: `Not enough blackmail tokens (have ${playerState.blackmailTokens}, spending ${totalBlackmail})` };
  }
  if (totalForce > playerState.forceTokens) {
    return { valid: false, error: `Not enough force tokens (have ${playerState.forceTokens}, spending ${totalForce})` };
  }

  return { valid: true };
}

// ── markBidsSubmitted ──────────────────────────────────────────────────────────
// Returns a new game state with the given player's hasSubmittedBids set to true.
// Immutable update — we don't modify the original state object.
function markBidsSubmitted(state: GameState, userId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.userId === userId ? { ...p, hasSubmittedBids: true } : p
    ),
  };
}

// ── resolveRound ───────────────────────────────────────────────────────────────
// The heart of Revolution: resolve all bids and determine winners.
//
// For each board space:
//   1. Find all bids on that space
//   2. Score each bid: force beats blackmail beats gold for tie-breaking
//   3. The highest score wins
//   4. Award support points and apply special abilities
//
// Revolution bid scoring:
//   - The bid value is gold + blackmail + force (total tokens)
//   - Ties are broken by: force first, then blackmail, then gold
//   - If still tied, no one wins the space (space is contested, no points)
function resolveRound(
  state: GameState,
  allBids: Record<string, unknown[]>
): { newState: GameState; results: BlockResult[] } {
  const results: BlockResult[] = [];

  // Work on a mutable copy of player scores and tokens
  const playerUpdates: Record<string, Partial<GameState["players"][number]>> = {};
  for (const p of state.players) {
    playerUpdates[p.userId] = {
      score: p.score,
      goldTokens: STARTING_TOKENS.gold,     // Reset to base allocation
      blackmailTokens: STARTING_TOKENS.blackmail,
      forceTokens: STARTING_TOKENS.force,
      hasSubmittedBids: false,               // Reset for next round
    };
  }

  // Process each board space
  for (const block of BLOCKS) {
    // Collect all bids for this block across all players
    const bidsForBlock: Array<{
      userId: string;
      username: string;
      gold: number;
      blackmail: number;
      force: number;
    }> = [];

    for (const player of state.players) {
      const playerBids = allBids[player.userId] as BidSubmission[] | undefined;
      if (!playerBids) continue;

      const bid = playerBids.find((b) => b.blockId === block.id);
      if (bid && (bid.gold > 0 || bid.blackmail > 0 || bid.force > 0)) {
        bidsForBlock.push({
          userId: player.userId,
          username: player.username,
          gold: bid.gold,
          blackmail: bid.blackmail,
          force: bid.force,
        });
      }
    }

    // Determine winner
    let winner: typeof bidsForBlock[number] | null = null;
    let winnerPoints = 0;

    if (bidsForBlock.length > 0) {
      // Sort by: total tokens desc, then force desc, then blackmail desc, then gold desc
      const scored = bidsForBlock.map((bid) => ({
        ...bid,
        total: bid.gold + bid.blackmail + bid.force,
      }));

      scored.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;       // Higher total wins
        if (b.force !== a.force) return b.force - a.force;       // More force wins tie
        if (b.blackmail !== a.blackmail) return b.blackmail - a.blackmail; // More blackmail
        return b.gold - a.gold;
      });

      // Check for a true tie (top two have identical scores)
      const top = scored[0];
      const second = scored[1];
      const isTied =
        second !== undefined &&
        top.total === second.total &&
        top.force === second.force &&
        top.blackmail === second.blackmail &&
        top.gold === second.gold;

      if (!isTied) {
        winner = top;
        winnerPoints = block.supportPoints;

        // Award support points
        playerUpdates[winner.userId] = {
          ...playerUpdates[winner.userId],
          score: (playerUpdates[winner.userId]?.score ?? 0) + winnerPoints,
        };

        // Apply special block abilities
        if (block.id === "apothecary") {
          playerUpdates[winner.userId].goldTokens =
            (playerUpdates[winner.userId].goldTokens ?? STARTING_TOKENS.gold) + 1;
        } else if (block.id === "blackmailer") {
          playerUpdates[winner.userId].blackmailTokens =
            (playerUpdates[winner.userId].blackmailTokens ?? STARTING_TOKENS.blackmail) + 1;
        } else if (block.id === "mercenary") {
          playerUpdates[winner.userId].forceTokens =
            (playerUpdates[winner.userId].forceTokens ?? STARTING_TOKENS.force) + 1;
        }
      }
    }

    results.push({
      blockId: block.id,
      winnerUserId: winner?.userId ?? null,
      winnerUsername: winner?.username ?? null,
      pointsAwarded: winnerPoints,
      bids: bidsForBlock,
    });
  }

  // Apply all player updates
  const updatedPlayers = state.players.map((p) => ({
    ...p,
    ...playerUpdates[p.userId],
  }));

  // Update board control (who controls each space this round)
  const updatedBoard = state.board.map((space) => {
    const result = results.find((r) => r.blockId === space.blockId);
    return {
      ...space,
      controlledBy: result?.winnerUserId ?? null,
    };
  });

  // Check if game is over
  const isGameOver = state.roundNumber >= TOTAL_ROUNDS;

  const newState: GameState = {
    ...state,
    phase: isGameOver ? "GAME_OVER" : "ROUND_OVER",
    players: updatedPlayers,
    board: updatedBoard,
    lastRoundResults: results,
    winner: isGameOver
      ? updatedPlayers.reduce((a, b) => (a.score > b.score ? a : b)).userId
      : null,
  };

  return { newState, results };
}

// ── startNextRound ─────────────────────────────────────────────────────────────
// Transitions from ROUND_OVER to BID_PHASE for the next round.
function startNextRound(state: GameState): GameState {
  return {
    ...state,
    phase: "BID_PHASE",
    roundNumber: state.roundNumber + 1,
    roundEndTime: Date.now() + 90_000, // 90 seconds for next round
    lastRoundResults: null,
  };
}

// Export all engine functions as a single object.
// Usage: import { engine } from './engine.js'
//        engine.createInitialState(...)
export const engine = {
  createInitialState,
  validateBids,
  markBidsSubmitted,
  resolveRound,
  startNextRound,
};
