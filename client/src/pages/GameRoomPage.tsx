// pages/GameRoomPage.tsx
//
// Handles the /:code route.
//
// Owns the socket lifecycle — connects on mount, disconnects on unmount.
// Joins the room once connected and listens for lobby events.
// Tracks socket connection status to show reconnecting/failed UI.

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import socket, { connectSocket, disconnectSocket } from "../services/socket";
import { useAuthStore } from "../store/authStore";
import type { PlayerInfo, GameState } from "../../../server/src/socket/types.js";
import LobbyView from "./LobbyView";
import GameView from "./GameView";

type View = "connecting" | "lobby" | "game" | "error";
type SocketStatus = "connecting" | "connected" | "reconnecting" | "failed";

export default function GameRoomPage() {
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();
    const { user, token, logout } = useAuthStore();
    const [view, setView] = useState<View>("connecting");
    const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
    const [joinError, setJoinError] = useState<string | null>(null);

    const [players, setPlayers] = useState<PlayerInfo[]>([]);
    const [ownerId, setOwnerId] = useState<string | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        if (!code || !token) {
            navigate("/");
            return;
        }

        // Called on every (re)connect — joins or rejoins the room.
        const joinRoom = () => {
            setSocketStatus("connected");
            socket.emit("lobby:join", { code }, (result) => {
                if (!result.success) {
                    setJoinError(result.error);
                    setView("error");
                    return;
                }
                if (result.gameState) {
                    setGameState(result.gameState);
                    localStorage.setItem("activeRoom", code);
                    setView("game");
                } else {
                    setView("lobby");
                }
            });
        };

        // Connect the socket now that we're in the room.
        connectSocket(token);

        socket.on("connect", joinRoom);
        socket.on("disconnect", () => setSocketStatus("reconnecting"));
        socket.io.on("reconnect_failed", () => setSocketStatus("failed"));

        socket.on("lobby:updated", (data) => {setPlayers(data.players);
            setOwnerId(data.ownerId);
        });
        socket.on("lobby:countdown", (data) => {
            if (countdownInterval.current) {
                clearInterval(countdownInterval.current);
                countdownInterval.current = null;
            }
            if (data.seconds === null) {
                setCountdown(null);
            } else {
                setCountdown(data.seconds);
                countdownInterval.current = setInterval(() => {
                    setCountdown((prev) => {
                        if (prev === null || prev <= 1) {
                            clearInterval(countdownInterval.current!);
                            countdownInterval.current = null;
                            return null;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
        });
        socket.on("lobby:kicked", () => {
            toast("You were kicked from the lobby", { icon: "🚫" });
            localStorage.removeItem("activeRoom");
            navigate("/");
        });
        socket.on("game:started", (state) => {
            setGameState(state);
            localStorage.setItem("activeRoom", code);
            setView("game");
        });
        socket.on("game:stateUpdate", (state) => {
            setGameState(state);
        });
        socket.on("game:closed", () => {
            localStorage.removeItem("activeRoom");
            navigate("/");
        });
        socket.on("notification:playerJoined", ({ username, isRejoin }) => {
            toast(`${username} has ${isRejoin ? "rejoined" : "joined"}`, { icon: isRejoin ? "🔄" : "👋" });
        });
        socket.on("notification:playerLeft", ({ username }) => {
            toast(`${username} has left`, { icon: "🚪" });
        });
        socket.on("notification:playerKicked", ({ username }) => {
            toast(`${username} was kicked`, { icon: "🚫" });
        });
        socket.on("notification:ownerChanged", ({ newOwnerUsername }) => {
            toast(`${newOwnerUsername} is now the host`, { icon: "👑" });
        });

        return () => {
            socket.off("connect", joinRoom);
            socket.off("disconnect");
            socket.off("lobby:updated");
            socket.off("lobby:countdown");
            if (countdownInterval.current) clearInterval(countdownInterval.current);
            socket.off("lobby:kicked");
            socket.off("game:started");
            socket.off("game:stateUpdate");
            socket.off("game:closed");
            socket.off("notification:playerJoined");
            socket.off("notification:playerLeft");
            socket.off("notification:playerKicked");
            socket.off("notification:ownerChanged");
            socket.io.off("reconnect_failed");
            disconnectSocket();
        };
    }, []);

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

    // ── Connection failure — block everything, ask user to refresh ──────────────
    if (socketStatus === "failed") {
        return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                <div className="bg-gray-900 rounded-lg p-8 text-center space-y-4">
                    <p className="text-xl text-white">Connection lost</p>
                    <p className="text-gray-400">Could not reconnect to the server.</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md"
                    >
                        Refresh Page
                    </button>
                </div>
            </div>
        );
    }

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

    if (view === "game" && gameState) {
        return <GameView gameState={gameState} userId={user?.id ?? ""} />;
    }

    // view === "lobby"
    return (
        <>
            {socketStatus === "reconnecting" && (
                <div className="fixed top-0 inset-x-0 bg-yellow-600 text-white text-center py-2 z-50">
                    Connection lost — reconnecting...
                </div>
            )}
            <LobbyView
                code={code ?? ""}
                players={players}
                ownerId={ownerId}
                countdown={countdown}
                userId={user?.id}
                isMyPlayerReady={isMyPlayerReady}
                isOwner={isOwner}
                onReady={handleReady}
                onKick={handleKick}
                onLeave={() => navigate("/")}
                onLogout={() => { logout(); navigate("/"); }}
            />
        </>
    );
}
