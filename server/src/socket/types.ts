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
  isConnected: boolean;
}

export interface BidSubmission {
  blockId: string;
  gold: number;
  blackmail: number;
  force: number;
}

export interface BlockResult {
  blockId: string;
  winnerUserId: string | null;
  winnerUsername: string | null;
  pointsAwarded: number;
  // All bids revealed after resolution
  bids: Array<{
    userId: string;
    username: string;
    gold: number;
    blackmail: number;
    force: number;
  }>;
}

// The full game state sent to clients.
// Pending bids are NOT included — they're secret until the round resolves.
export interface GameState {
  // The human-readable join code (e.g. "blue1234") — used as the game identifier
  gameId: string;
  phase: "BID_PHASE" | "RESOLVING" | "ROUND_OVER" | "GAME_OVER";
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
  board: Array<{
    blockId: string;
    blockName: string;
    controlledBy: string | null; // userId of current controller
    pointValue: number;
  }>;
  lastRoundResults: BlockResult[] | null;
  winner: string | null; // userId of winner when game ends
}

// ── Server → Client Events ─────────────────────────────────────────────────────

export interface ServerToClientEvents {
  // Lobby state changed (player joined/left/readied, kick happened)
  "lobby:updated": (data: {
    players: PlayerInfo[];
    maxPlayers: number;
    ownerId: string;
  }) => void;

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
}

// ── Client → Server Events ─────────────────────────────────────────────────────

export interface ClientToServerEvents {
  // Join the lobby room. Called when the player lands on /lobby/:code.
  // Returns success + initial lobby state, OR spectator state if game already started.
  "lobby:join": (
    data: { code: string },
    callback: (res:
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

  // Submit bids for all board spaces simultaneously
  "game:submitBids": (
    data: { bids: BidSubmission[] },
    callback: (res: { success: boolean; error?: string }) => void
  ) => void;

  // In-game chat
  "chat:send": (data: { message: string }) => void;
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
