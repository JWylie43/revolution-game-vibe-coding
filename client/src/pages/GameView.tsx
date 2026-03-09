// pages/GameView.tsx
//
// Active game UI — board, bids, scoreboard, and overlays.
// Receives game state as props from GameRoomPage.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../services/socket";
import { useAuthStore } from "../store/authStore";
import type { GameState, BlockResult } from "../../../server/src/socket/types.js";

interface Props {
  state: GameState | null;
  isSpectator: boolean;
  code: string;
  disconnectedPlayer: {
    userId: string;
    username: string;
    secondsRemaining: number;
  } | null;
}

export default function GameView({ state, isSpectator, code, disconnectedPlayer }: Props) {
  if (!state) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl text-gray-400">Connecting to game...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gray-900 text-white">
      <GameBoard state={state} isSpectator={isSpectator} code={code} />

      {disconnectedPlayer && (
        <DisconnectOverlay
          username={disconnectedPlayer.username}
          secondsRemaining={disconnectedPlayer.secondsRemaining}
        />
      )}

      {state.phase === "ROUND_OVER" && state.lastRoundResults && (
        <RoundResultsOverlay results={state.lastRoundResults} players={state.players} />
      )}

      {state.phase === "GAME_OVER" && state.winner && (
        <GameOverOverlay state={state} />
      )}
    </div>
  );
}

// ── Game Board ─────────────────────────────────────────────────────────────────

function GameBoard({
  state,
  isSpectator,
  code,
}: {
  state: GameState;
  isSpectator: boolean;
  code: string;
}) {
  const { user } = useAuthStore();
  const myPlayer = state.players.find((p) => p.userId === user?.id);

  const [pendingBids, setPendingBids] = useState<
    Record<string, { gold: number; blackmail: number; force: number }>
  >({});
  const [submitted, setSubmitted] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  // Reset bids each new round
  useEffect(() => {
    setSubmitted(false);
    setPendingBids({});
    setBidError(null);
  }, [state.roundNumber]);

  const handleBidChange = (
    blockId: string,
    type: "gold" | "blackmail" | "force",
    value: number
  ) => {
    setPendingBids((prev) => ({
      ...prev,
      [blockId]: {
        ...(prev[blockId] ?? { gold: 0, blackmail: 0, force: 0 }),
        [type]: Math.max(0, value),
      },
    }));
  };

  const handleSubmitBids = () => {
    setBidError(null);
    const bids = Object.entries(pendingBids)
      .filter(([, bid]) => bid.gold > 0 || bid.blackmail > 0 || bid.force > 0)
      .map(([blockId, bid]) => ({ blockId, ...bid }));

    socket.emit("game:submitBids", { bids }, (result) => {
      if (result.success) {
        setSubmitted(true);
      } else {
        setBidError(result.error ?? "Failed to submit bids");
      }
    });
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold">
            Revolution
            {isSpectator && (
              <span className="ml-3 text-sm font-normal text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                SPECTATING
              </span>
            )}
          </h2>
          <p className="text-gray-400 text-sm">
            Round {state.roundNumber} · {state.phase.replace(/_/g, " ")}
            {" · "}
            <span className="font-mono text-gray-500">{code}</span>
          </p>
        </div>
        {state.roundEndTime && state.phase === "BID_PHASE" && (
          <CountdownTimer endTime={state.roundEndTime} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Board */}
        <div className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">City Board</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {state.board.map((space) => (
              <div
                key={space.blockId}
                className="bg-gray-800 rounded-lg p-3 border border-gray-700"
              >
                <div className="font-medium text-sm">{space.blockName}</div>
                <div className="text-xs text-yellow-400 mb-2">{space.pointValue} pts</div>

                {state.phase === "BID_PHASE" && !submitted && myPlayer && !isSpectator && (
                  <div className="space-y-1">
                    <BidInput
                      label="G"
                      color="text-yellow-400"
                      value={pendingBids[space.blockId]?.gold ?? 0}
                      max={myPlayer.goldTokens}
                      onChange={(v) => handleBidChange(space.blockId, "gold", v)}
                    />
                    <BidInput
                      label="B"
                      color="text-purple-400"
                      value={pendingBids[space.blockId]?.blackmail ?? 0}
                      max={myPlayer.blackmailTokens}
                      onChange={(v) => handleBidChange(space.blockId, "blackmail", v)}
                    />
                    <BidInput
                      label="F"
                      color="text-red-400"
                      value={pendingBids[space.blockId]?.force ?? 0}
                      max={myPlayer.forceTokens}
                      onChange={(v) => handleBidChange(space.blockId, "force", v)}
                    />
                  </div>
                )}

                {space.controlledBy && (
                  <div className="text-xs text-green-400 mt-1">
                    {state.players.find((p) => p.userId === space.controlledBy)?.username}
                  </div>
                )}
              </div>
            ))}
          </div>

          {state.phase === "BID_PHASE" && !submitted && !isSpectator && (
            <div className="mt-4">
              {bidError && (
                <div className="text-red-400 text-sm mb-2">{bidError}</div>
              )}
              <button
                onClick={handleSubmitBids}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md transition-colors"
              >
                Submit Bids
              </button>
            </div>
          )}

          {submitted && state.phase === "BID_PHASE" && (
            <div className="mt-4 text-center text-green-400 font-medium">
              Bids submitted! Waiting for other players...
            </div>
          )}

          {isSpectator && state.phase === "BID_PHASE" && (
            <div className="mt-4 text-center text-yellow-400 text-sm">
              Spectators cannot submit bids
            </div>
          )}
        </div>

        {/* Scoreboard */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">Players</h3>
          <div className="space-y-2">
            {[...state.players]
              .sort((a, b) => b.score - a.score)
              .map((player) => (
                <div
                  key={player.userId}
                  className={`bg-gray-800 rounded-lg p-3 border ${
                    player.userId === user?.id ? "border-indigo-500" : "border-gray-700"
                  } ${!player.isConnected ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">
                      {player.username}
                      {!player.isConnected && (
                        <span className="ml-2 text-xs text-red-400">disconnected</span>
                      )}
                    </span>
                    <span className="text-yellow-400 font-bold">{player.score} pts</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-yellow-400">G: {player.goldTokens}</span>
                    <span className="text-purple-400">B: {player.blackmailTokens}</span>
                    <span className="text-red-400">F: {player.forceTokens}</span>
                  </div>
                  {player.hasSubmittedBids && state.phase === "BID_PHASE" && (
                    <div className="text-xs text-green-400 mt-1">Submitted</div>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Disconnect Overlay ─────────────────────────────────────────────────────────

function DisconnectOverlay({
  username,
  secondsRemaining,
}: {
  username: string;
  secondsRemaining: number;
}) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20">
      <div className="bg-gray-800 border border-yellow-600 rounded-lg px-6 py-3 shadow-xl text-center">
        <p className="text-yellow-400 font-semibold">{username} disconnected</p>
        <p className="text-gray-400 text-sm">
          Game closes in{" "}
          <span className="text-white font-mono">{secondsRemaining}</span>s if they don't return
        </p>
      </div>
    </div>
  );
}

// ── Bid Input ──────────────────────────────────────────────────────────────────

function BidInput({
  label,
  color,
  value,
  max,
  onChange,
}: {
  label: string;
  color: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className={`text-xs font-bold w-4 ${color}`}>{label}</span>
      <button
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        className="w-5 h-5 bg-gray-600 rounded text-xs disabled:opacity-30"
      >
        -
      </button>
      <span className="w-4 text-center text-xs">{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="w-5 h-5 bg-gray-600 rounded text-xs disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

// ── Countdown Timer ────────────────────────────────────────────────────────────

function CountdownTimer({ endTime }: { endTime: number }) {
  const [remaining, setRemaining] = useState(Math.max(0, endTime - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      const r = Math.max(0, endTime - Date.now());
      setRemaining(r);
      if (r === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const seconds = Math.ceil(remaining / 1000);
  const isUrgent = seconds <= 15;

  return (
    <div className={`text-2xl font-mono font-bold ${isUrgent ? "text-red-400" : "text-white"}`}>
      {seconds}s
    </div>
  );
}

// ── Round Results Overlay ──────────────────────────────────────────────────────

function RoundResultsOverlay({
  results,
}: {
  results: BlockResult[];
  players: GameState["players"];
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-10">
      <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4">
        <h3 className="text-xl font-bold mb-4">Round Results</h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <div key={r.blockId} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{r.blockId}</span>
              {r.winnerUsername ? (
                <span className="text-green-400">
                  {r.winnerUsername} +{r.pointsAwarded}pts
                </span>
              ) : (
                <span className="text-gray-500">No winner</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-gray-400 text-sm mt-4">Next round starting...</p>
      </div>
    </div>
  );
}

// ── Game Over Overlay ──────────────────────────────────────────────────────────

function GameOverOverlay({ state }: { state: GameState }) {
  const navigate = useNavigate();
  const winner = state.players.find((p) => p.userId === state.winner);
  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-10">
      <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4 text-center">
        <h3 className="text-3xl font-bold mb-1">Game Over!</h3>
        <p className="text-xl text-yellow-400 mb-6">{winner?.username} wins!</p>
        <div className="space-y-2 mb-6">
          {sorted.map((p, i) => (
            <div key={p.userId} className="flex items-center justify-between">
              <span className="text-gray-300">{i + 1}. {p.username}</span>
              <span className="font-bold">{p.score} pts</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => navigate("/")}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
