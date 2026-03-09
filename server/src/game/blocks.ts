// game/blocks.ts
//
// Defines all the board spaces ("blocks") in Revolution.
//
// In Revolution, the board represents a city. Players bid on city figures
// (the Printer, Apothecary, etc.) to gain support tokens (victory points)
// and special abilities.
//
// Data source: Steve Jackson Games Revolution rulebook
// https://www.sjgames.com/revolution/
//
// Each block has:
//   - A unique ID (used as the key everywhere)
//   - A display name
//   - How many support points winning this block awards
//   - A special ability (some blocks give bonus effects when won)

export interface Block {
  id: string;
  name: string;
  supportPoints: number;  // Victory points awarded to the winner each round
  description: string;    // What this block does / its special ability
}

// The complete list of blocks in Revolution.
// In the physical game these are tiles on a city board.
export const BLOCKS: Block[] = [
  // ── High-Value Blocks ──────────────────────────────────────────────────────
  // These are worth the most points and are heavily contested.
  {
    id: "general",
    name: "General",
    supportPoints: 4,
    description: "Controls military force. Worth 4 support.",
  },
  {
    id: "captain",
    name: "Captain",
    supportPoints: 3,
    description: "Commands the city guard. Worth 3 support.",
  },
  {
    id: "innkeeper",
    name: "Innkeeper",
    supportPoints: 3,
    description: "Runs the main tavern, hub of information. Worth 3 support.",
  },
  {
    id: "magistrate",
    name: "Magistrate",
    supportPoints: 3,
    description: "Enforces city law. Worth 3 support.",
  },

  // ── Mid-Value Blocks ───────────────────────────────────────────────────────
  {
    id: "priest",
    name: "Priest",
    supportPoints: 2,
    description: "Leads the church. Worth 2 support.",
  },
  {
    id: "aristocrat",
    name: "Aristocrat",
    supportPoints: 2,
    description: "Represents the nobility. Worth 2 support.",
  },
  {
    id: "merchant",
    name: "Merchant",
    supportPoints: 2,
    description: "Controls trade. Worth 2 support.",
  },
  {
    id: "printer",
    name: "Printer",
    supportPoints: 2,
    description: "Controls the press. Worth 2 support.",
  },

  // ── Token-Granting Blocks ──────────────────────────────────────────────────
  // These give you more tokens to bid with in future rounds.
  {
    id: "apothecary",
    name: "Apothecary",
    supportPoints: 1,
    description: "Grants 1 gold token next round in addition to 1 support.",
  },
  {
    id: "blackmailer",
    name: "Blackmailer",
    supportPoints: 1,
    description: "Grants 1 blackmail token next round in addition to 1 support.",
  },
  {
    id: "mercenary",
    name: "Mercenary",
    supportPoints: 1,
    description: "Grants 1 force token next round in addition to 1 support.",
  },

  // ── Special Blocks ─────────────────────────────────────────────────────────
  {
    id: "spy",
    name: "Spy",
    supportPoints: 0,
    description: "Lets you peek at one opponent's bid before the reveal. Worth 0 support but grants intel.",
  },
  {
    id: "aristocrat_house",
    name: "Aristocrat's House",
    supportPoints: 1,
    description: "Worth 1 support.",
  },
];

// A lookup map: blockId → Block. Faster than searching the array every time.
export const BLOCK_MAP: Record<string, Block> = Object.fromEntries(
  BLOCKS.map((b) => [b.id, b])
);

// Total number of rounds in a game.
// Revolution ends after all board spaces have been contested N rounds.
// Standard game: 5 rounds.
export const TOTAL_ROUNDS = 5;

// Starting tokens for each player at the beginning of each round.
// In Revolution, players receive a fixed allocation of tokens at round start.
export const STARTING_TOKENS = {
  gold: 3,
  blackmail: 2,
  force: 1,
};
