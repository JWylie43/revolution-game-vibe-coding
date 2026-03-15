// socket/types.ts
//
// TypeScript type definitions for all Socket.io events.
//
// Structure:
//   ServerToClientEvents — events the SERVER sends TO the browser
//   ClientToServerEvents — events the BROWSER sends TO the server
//   InterServerEvents    — events between multiple server instances (Redis adapter)
//   SocketData           — data attached to each socket connection (like req.user)

// ── Shared Data Shapes ─────────────────────────────────────────────────────────

// A player in the lobby waiting room
export interface PlayerInfo {
    userId: string;
    username: string;
    avatarUrl: string | null;
    seatNumber: number;
    isReady: boolean;
}

export interface BidSubmission {
    blockId: string;   // bid space id
    gold: number;
    blackmail: number;
    force: number;
}

// Result for a single bid space after a round resolves
export interface BlockResult {
    blockId: string;              // bid space id
    winnerUserId: string | null;
    winnerUsername: string | null;
    support: number;              // support directly awarded to winner
    gold: number;                 // gold tokens awarded to winner
    blackmail: number;            // blackmail tokens awarded to winner
    force: number;                // force tokens awarded to winner
    influenceLocationId: string | null;  // location where winner placed a block (if any)
    special: "spy" | "apothecary" | null;
    bids: Array<{
        userId: string;
        username: string;
        gold: number;
        blackmail: number;
        force: number;
    }>;
}

// One slot in a board location — holds one influence block
export interface InfluenceSlot {
    slotIndex: number;
    occupiedBy: string | null;         // userId
    occupiedByUsername: string | null;
}

// A completed special action within the current round (for round history).
// Populated as actions execute; cleared when the next round begins.
export interface CompletedSpecialAction {
    type: "spy" | "apothecary";
    userId: string;
    username: string;
    skipped: boolean;
    // Spy: which slot was targeted and who was displaced
    spyTarget?: {
        locationId: string;
        slotIndex: number;
        previousUserId: string;
        previousUsername: string;
    };
    // Apothecary: which two slots were swapped (before the swap)
    apothecarySwap?: {
        slotA: { locationId: string; slotIndex: number; userId: string; username: string };
        slotB: { locationId: string; slotIndex: number; userId: string; username: string };
    };
}

// A snapshot of one completed round — stored in Redis and written to Postgres at game end.
export interface RoundSnapshot {
    roundNumber: number;
    results: BlockResult[];                    // revealed bids + outcomes for every bid space
    specialActions: CompletedSpecialAction[];  // spy/apothecary actions (or skips) this round
    boardLocations: GameState["boardLocations"]; // board state AFTER all actions
    playerScores: Array<{ userId: string; username: string; score: number }>;
}

// The full game state sent to clients.
// Pending bids are NOT included — they're secret until the round resolves.
export interface GameState {
    // The human-readable join code (e.g. "blue1234") — used as the game identifier
    gameId: string;
    phase: "BID_PHASE" | "RESOLVING" | "SPECIAL_ACTIONS" | "ROUND_OVER" | "GAME_OVER";
    roundNumber: number;
    roundEndTime: number | null; // Unix timestamp (ms) when the bid timer expires
    players: Array<{
        userId: string;
        username: string;
        seatNumber: number;
        score: number;
        goldTokens: number;
        blackmailTokens: number;
        forceTokens: number;
        hasSubmittedBids: boolean;
        isConnected: boolean;
    }>;
    // The 7 city board locations where influence blocks accumulate
    boardLocations: Array<{
        locationId: string;
        locationName: string;
        endGameSupport: number;
        slots: InfluenceSlot[];
    }>;
    lastRoundResults: BlockResult[] | null;
    resultsAckUserIds: string[]; // players who clicked OK on the round results
    winner: string | null; // userId of winner when game ends
    // Queue of spy / apothecary actions to resolve before advancing the round.
    // Index 0 = currently acting player. Empty = no pending actions.
    pendingSpecialActions: Array<{
        type: "spy" | "apothecary";
        userId: string;
        username: string;
    }>;
    // Special actions that have already executed this round (populated as they fire,
    // cleared at the start of each new round). Used for round history snapshots.
    completedSpecialActions?: CompletedSpecialAction[];
}

// ── Server → Client Events ─────────────────────────────────────────────────────

export interface ServerToClientEvents {
    // Lobby state changed (player joined/left/readied, kick happened)
    "lobby:updated": (data: { players: PlayerInfo[]; ownerId: string }) => void;

    // 5-second countdown before game starts. seconds=null means countdown cancelled.
    "lobby:countdown": (data: { seconds: number | null }) => void;

    // Sent to a player who was kicked by the owner
    "lobby:kicked": (data: { reason: string }) => void;

    // Sent when the game starts — full initial state
    "game:started": (state: GameState) => void;

    // Sent after any game state change
    "game:stateUpdate": (state: GameState) => void;

    // Sent when a round's bids are resolved (bids now revealed)
    "game:roundResolved": (results: BlockResult[]) => void;

    // Sent when the game ends normally
    "game:over": (data: {
        winnerId: string;
        winnerUsername: string;
        finalScores: Array<{ userId: string; username: string; score: number }>;
    }) => void;

    // A player disconnected — shows a countdown before the game closes
    "game:playerDisconnected": (data: {
        userId: string;
        username: string;
        secondsRemaining: number;
    }) => void;

    // A player reconnected — cancel the disconnect overlay
    "game:playerReconnected": (data: { userId: string; username: string }) => void;

    // The game was force-closed (player didn't reconnect in time)
    "game:closed": (data: { reason: string }) => void;

    // Feedback to the player who submitted bids
    "game:bidAccepted": (data: { blockId: string }) => void;
    "game:error": (data: { message: string }) => void;

    // In-game chat
    "chat:message": (data: {
        userId: string;
        username: string;
        message: string;
        timestamp: number;
    }) => void;

    // Toast notifications
    "notification:playerLeft": (data: { username: string }) => void;
    "notification:playerKicked": (data: { username: string }) => void;
    "notification:ownerChanged": (data: { newOwnerUsername: string }) => void;
    "notification:playerJoined": (data: { username: string; isRejoin: boolean }) => void;

    // Dev-only server log — see socket/logger.ts
    "logger:log": (data: { label: string; data: unknown; ts: number }) => void;
}

// ── Client → Server Events ─────────────────────────────────────────────────────

export interface ClientToServerEvents {
    // Join the lobby room. Called when the player lands on /lobby/:code.
    // Returns success + initial lobby state, OR spectator state if game already started.
    "lobby:join": (
        data: { code: string },
        callback: (
            res:
                | { success: true; isSpectator: boolean; gameState: GameState }
                | { success: true; isSpectator: false; gameState?: never }
                | { success: false; error: string }
        ) => void
    ) => void;

    // Toggle ready state in the lobby
    "lobby:ready": (
        data: { ready: boolean },
        callback: (res: { success: boolean }) => void
    ) => void;

    // Owner kicks a player from the lobby (pre-game only)
    "lobby:kick": (
        data: { targetUserId: string },
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // Player explicitly leaves an active game (starts 60s rejoin timer)
    "game:leave": () => void;

    // Submit bids for the current round
    "game:submitBids": (
        data: { bids: BidSubmission[] },
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // Acknowledge round results — next round starts when all connected players have acked
    "game:resultsAck": (
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // Spy winner: replace one opponent's cube with their own.
    // Pass skip=true to forfeit the action without picking.
    "game:spyAction": (
        data: { locationId?: string; slotIndex?: number; skip?: boolean },
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // Apothecary winner: swap any two occupied cubes on the board.
    // Pass skip=true to forfeit the action without picking.
    "game:apothecaryAction": (
        data: {
            slotA?: { locationId: string; slotIndex: number };
            slotB?: { locationId: string; slotIndex: number };
            skip?: boolean;
        },
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // In-game chat
    "chat:send": (data: { message: string }) => void;

    // DEV ONLY — fills the board and jumps straight to GAME_OVER for testing.
    // No-ops in production (server handler is not registered).
    "dev:skipToEnd": (
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // DEV ONLY — starts auto-play: bots submit random bids and advance every phase
    // automatically at ~600ms intervals until GAME_OVER.
    "dev:autoPlay": (
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;

    // DEV ONLY — stops a running auto-play loop.
    "dev:stopAutoPlay": (
        callback: (res: { success: boolean; error?: string }) => void
    ) => void;
}

// ── Inter-Server Events ────────────────────────────────────────────────────────
export interface InterServerEvents {}

// ── Socket Data ────────────────────────────────────────────────────────────────
// Attached to each authenticated socket. Populated during connection auth.
export interface SocketData {
    userId: string;
    username: string;
    // The lobby/game code this socket is connected to (undefined if not in any)
    code: string | undefined;
    // True if this socket joined a game that was already in progress
    isSpectator: boolean;
}
