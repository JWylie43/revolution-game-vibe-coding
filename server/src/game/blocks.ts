// game/blocks.ts
//
// Defines all game data for Revolution:
//   BID_SPACES   — the 12 figures players bid on each round
//   BOARD_LOCATIONS — the 7 city locations where influence blocks are placed
//
// Bid board mechanics:
//   - Each round, players secretly allocate gold/blackmail/force tokens across bid spaces
//   - The player with the highest total bid wins each space; ties broken by force > blackmail > gold
//   - Winning a space gives the listed rewards immediately
//   - Rewards include direct support, token grants, placing an influence block, or a special action
//
// Board location mechanics:
//   - Board locations have a fixed number of influence slots
//   - Winning certain bid spaces lets you place one influence block in the linked location
//   - At game end, the player with the most blocks in a location earns that location's support bonus
//
// Source: Steve Jackson Games Revolution! rulebook

// ── Bid Space ─────────────────────────────────────────────────────────────────

export interface BidSpace {
    id: string;
    name: string;
    // Bid restrictions — shown as colored backgrounds on the physical board
    noForce: boolean;      // Red background: cannot bid Force tokens on this space
    noBlackmail: boolean;  // Dark background: cannot bid Blackmail tokens on this space
    // What the winner receives
    rewards: {
        support: number;
        gold: number;
        blackmail: number;
        force: number;
        influenceLocation: string | null;  // locationId to place an influence block, or null
        special: "spy" | "apothecary" | null;
    };
}

// ── Board Location ─────────────────────────────────────────────────────────────

export interface BoardLocation {
    id: string;
    name: string;
    slots: number;          // Total influence block slots in this location
    endGameSupport: number; // Support awarded to the majority controller at game end
}

// ── The 12 Bid Spaces ──────────────────────────────────────────────────────────

export const BID_SPACES: BidSpace[] = [
    // ── Row 1: Red backgrounds (No Force) ─────────────────────────────────────
    {
        id: "general",
        name: "General",
        noForce: true, noBlackmail: false,
        rewards: { support: 1, gold: 0, blackmail: 0, force: 1, influenceLocation: "fortress", special: null },
    },
    {
        id: "captain",
        name: "Captain",
        noForce: true, noBlackmail: false,
        rewards: { support: 1, gold: 0, blackmail: 0, force: 1, influenceLocation: "harbor", special: null },
    },
    // ── Row 1: Dark backgrounds (No Blackmail) ─────────────────────────────────
    {
        id: "innkeeper",
        name: "Innkeeper",
        noForce: false, noBlackmail: true,
        rewards: { support: 3, gold: 0, blackmail: 1, force: 0, influenceLocation: "tavern", special: null },
    },
    {
        id: "magistrate",
        name: "Magistrate",
        noForce: false, noBlackmail: true,
        rewards: { support: 1, gold: 0, blackmail: 1, force: 0, influenceLocation: "town_hall", special: null },
    },
    // ── Row 2: No bid restrictions ─────────────────────────────────────────────
    {
        id: "priest",
        name: "Priest",
        noForce: false, noBlackmail: false,
        rewards: { support: 6, gold: 0, blackmail: 0, force: 0, influenceLocation: "cathedral", special: null },
    },
    {
        id: "aristocrat",
        name: "Aristocrat",
        noForce: false, noBlackmail: false,
        rewards: { support: 5, gold: 3, blackmail: 0, force: 0, influenceLocation: "plantation", special: null },
    },
    {
        id: "merchant",
        name: "Merchant",
        noForce: false, noBlackmail: false,
        rewards: { support: 3, gold: 5, blackmail: 0, force: 0, influenceLocation: "market", special: null },
    },
    {
        id: "printer",
        name: "Printer",
        noForce: false, noBlackmail: false,
        rewards: { support: 10, gold: 0, blackmail: 0, force: 0, influenceLocation: null, special: null },
    },
    // ── Row 3: Special/action spaces ──────────────────────────────────────────
    {
        id: "rogue",
        name: "Rogue",
        noForce: true, noBlackmail: false,
        rewards: { support: 0, gold: 0, blackmail: 2, force: 0, influenceLocation: null, special: null },
    },
    {
        id: "spy",
        name: "Spy",
        noForce: false, noBlackmail: true,
        rewards: { support: 0, gold: 0, blackmail: 0, force: 0, influenceLocation: null, special: "spy" },
    },
    {
        id: "apothecary",
        name: "Apothecary",
        noForce: true, noBlackmail: false,
        rewards: { support: 0, gold: 0, blackmail: 0, force: 0, influenceLocation: null, special: "apothecary" },
    },
    {
        id: "mercenary",
        name: "Mercenary",
        noForce: true, noBlackmail: false,
        rewards: { support: 3, gold: 0, blackmail: 0, force: 1, influenceLocation: null, special: null },
    },
];

export const BID_SPACE_MAP: Record<string, BidSpace> = Object.fromEntries(
    BID_SPACES.map((s) => [s.id, s])
);

// ── The 7 Board Locations ──────────────────────────────────────────────────────
// Slot counts and support values from the physical game board.

export const BOARD_LOCATIONS: BoardLocation[] = [
    { id: "plantation", name: "Plantation", slots: 6, endGameSupport: 30 },
    { id: "tavern",     name: "Tavern",     slots: 4, endGameSupport: 20 },
    { id: "cathedral",  name: "Cathedral",  slots: 7, endGameSupport: 35 },
    { id: "town_hall",  name: "Town Hall",  slots: 6, endGameSupport: 45 },
    { id: "fortress",   name: "Fortress",   slots: 8, endGameSupport: 50 },
    { id: "market",     name: "Market",     slots: 5, endGameSupport: 25 },
    { id: "harbor",     name: "Harbor",     slots: 6, endGameSupport: 40 },
];

export const BOARD_LOCATION_MAP: Record<string, BoardLocation> = Object.fromEntries(
    BOARD_LOCATIONS.map((l) => [l.id, l])
);

// Starting token allocation at the beginning of each round (base, before bonuses)
export const STARTING_TOKENS = {
    gold: 3,
    blackmail: 1,
    force: 1,
};
