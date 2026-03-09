// pages/GameRoomPage.tsx
//
// Orchestrator for the /:code route.
//
// Owns the socket connection and view-switching logic. Renders one of:
//   "connecting" — waiting for lobby:join ack
//   "lobby"      — <LobbyView>
//   "game"       — <GameView>
//   "error"      — join failed (full, invalid code, etc.)
//
// No UI of its own beyond the connecting/error screens — all the real
// rendering is delegated to LobbyView and GameView.

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import socket from "../services/socket";
import { useAuthStore } from "../store/authStore";
import type { PlayerInfo, GameState } from "../../../server/src/socket/types.js";
import LobbyView from "./LobbyView";
import GameView from "./GameView";

type View = "connecting" | "lobby" | "game" | "error";

export default function GameRoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [view, setView] = useState<View>("connecting");
  const [joinError, setJoinError] = useState<string | null>(null);

  // ── Lobby state ────────────────────────────────────────────────────────────
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  // ── Game state ─────────────────────────────────────────────────────────────
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isSpectator, setIsSpectator] = useState(false);
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<{
    userId: string;
    username: string;
    secondsRemaining: number;
  } | null>(null);

  useEffect(() => {
    if (!code) { navigate("/"); return; }

    // ── Join the room ──────────────────────────────────────────────────────
    const joinRoom = () => {
      socket.emit("lobby:join", { code }, (result) => {
        if (!result.success) {
          setJoinError(result.error);
          setView("error");
          return;
        }
        if (result.gameState) {
          setGameState(result.gameState);
          setIsSpectator(result.isSpectator);
          setView("game");
        } else {
          setView("lobby");
        }
      });
    };
    if (socket.connected) joinRoom();

    // ── Lobby events ───────────────────────────────────────────────────────
    socket.on("lobby:updated", (data) => {
      setPlayers(data.players);
      setOwnerId(data.ownerId);
    });
    socket.on("lobby:countdown", (data) => { setCountdown(data.seconds); });

    // ── Game start — switch view in-place ──────────────────────────────────
    socket.on("game:started", (state: GameState) => {
      setGameState(state);
      setIsSpectator(false);
      setView("game");
    });

    // ── Game events ────────────────────────────────────────────────────────
    socket.on("game:stateUpdate", (state) => { setGameState(state); });
    socket.on("game:roundResolved", () => {});

    socket.on("game:playerDisconnected", (data) => {
      setDisconnectedPlayer(data);
      let secs = data.secondsRemaining;
      if (disconnectCountdownRef.current) clearInterval(disconnectCountdownRef.current);
      disconnectCountdownRef.current = setInterval(() => {
        secs -= 1;
        setDisconnectedPlayer((prev) => prev ? { ...prev, secondsRemaining: secs } : null);
        if (secs <= 0 && disconnectCountdownRef.current) clearInterval(disconnectCountdownRef.current);
      }, 1000);
    });

    socket.on("game:playerReconnected", () => {
      setDisconnectedPlayer(null);
      if (disconnectCountdownRef.current) {
        clearInterval(disconnectCountdownRef.current);
        disconnectCountdownRef.current = null;
      }
    });

    socket.on("game:closed", () => { navigate("/"); });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("beforeunload", handleBeforeUnloadWarning);
      socket.off("connect", joinRoom);
      socket.off("connect_error", handleConnectError);
      socket.off("lobby:updated");
      socket.off("lobby:countdown");
      socket.off("lobby:kicked");
      socket.off("game:started");
      socket.off("game:stateUpdate");
      socket.off("game:roundResolved");
      socket.off("game:playerDisconnected");
      socket.off("game:playerReconnected");
      socket.off("game:closed");
      if (disconnectCountdownRef.current) clearInterval(disconnectCountdownRef.current);

      // Only emit game:leave on intentional SPA navigation away from an active game
      if (!isRefreshingRef.current && !isSpectatorRef.current && viewRef.current === "game") {
        socket.emit("game:leave");
      }
    };
  }, []);

  // ── Lobby actions ──────────────────────────────────────────────────────────
  const myPlayer = players.find((p) => p.userId === user?.id);
  const isMyPlayerReady = myPlayer?.isReady ?? isReady;
  const isOwner = user?.id === ownerId;

  const handleReady = () => {
    const newReady = !isMyPlayerReady;
    socket.emit("lobby:ready", { ready: newReady }, (result) => {
      if (result.success) setIsReady(newReady);
    });
  };

  const handleKick = (targetUserId: string) => {
    socket.emit("lobby:kick", { targetUserId }, () => {});
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (view === "connecting") {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-xl text-gray-400">Joining lobby...</div>
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold mb-4 text-red-400">Cannot Join</h2>
          <p className="text-gray-300 mb-6">{joinError}</p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (view === "lobby") {
    return (
      <LobbyView
        code={code ?? ""}
        players={players}
        maxPlayers={maxPlayers}
        ownerId={ownerId}
        countdown={countdown}
        userId={user?.id}
        isMyPlayerReady={isMyPlayerReady}
        isOwner={isOwner}
        onReady={handleReady}
        onKick={handleKick}
      />
    );
  }

  // view === "game"
  return (
    <GameView
      state={gameState}
      isSpectator={isSpectator}
      code={code ?? ""}
      disconnectedPlayer={disconnectedPlayer}
    />
  );
}
