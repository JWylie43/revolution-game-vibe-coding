// pages/HomePage.tsx
//
// The home screen: create a game or browse open lobbies.
// Polls /api/lobby/list every 5 seconds to keep the table fresh.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import api from "../services/api";
import CityBoard from "../components/CityBoard.js";
import BidBoardNew from "../components/BidBoardNew.js";


const COLORS = ["red", "blue", "green", "gold", "purple", "orange", "silver", "black", "teal"];
function generateCode(): string {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const digits = String(Math.floor(Math.random() * 9000) + 1000);
    return `${color}${digits}`;
}

interface LobbyEntry {
    code: string;
    ownerUsername: string;
    playerCount: number;
    maxPlayers: number;
    createdAt: number;
}

export default function HomePage() {
    const { user, logout } = useAuthStore();
    const navigate = useNavigate();
    const [showBoard, setShowBoard] = useState(false);
    const [showBidBoard, setShowBidBoard] = useState(false);

    const [activeRoom, setActiveRoom] = useState(() => localStorage.getItem("activeRoom"));
    const [lobbies, setLobbies] = useState<LobbyEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchLobbies = async () => {
        try {
            const { data } = await api.get<{ lobbies: LobbyEntry[] }>("/lobby/list");
            setLobbies(data.lobbies);
            setLastRefreshed(new Date());
        } catch {
            // Silently fail — stale data is fine
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLobbies();
        intervalRef.current = setInterval(fetchLobbies, 5000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const handleCreateGame = () => {
        navigate(`/${generateCode()}`);
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white">
            {/* ── Nav ─────────────────────────────────────────────────────────── */}
            <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <h1 className="text-xl font-bold">Revolution</h1>
                    <div className="flex items-center gap-4">
                        <span className="text-gray-400">
                            Welcome,{" "}
                            <span className="text-white font-medium">{user?.username}</span>
                        </span>
                        <button
                            onClick={() => setShowBoard(true)}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            View Board
                        </button>
                        <button
                            onClick={() => setShowBidBoard(true)}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            Bid Reference
                        </button>
                        <button
                            onClick={logout}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            </nav>

            {/* ── Main ────────────────────────────────────────────────────────── */}
            <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
                <div className="text-center">
                    <h2 className="text-4xl font-bold mb-2">Play Revolution</h2>
                    <p className="text-gray-400">Bid for control. Seize the city.</p>
                </div>

                {/* Active room banner */}
                {activeRoom && (
                    <div className="bg-indigo-900/50 border border-indigo-500 rounded-lg px-5 py-4 flex items-center justify-between">
                        <div>
                            <p className="text-white font-medium">You have an active room</p>
                            <p className="text-indigo-300 text-sm font-mono">{activeRoom}</p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    localStorage.removeItem("activeRoom");
                                    setActiveRoom(null);
                                }}
                                className="text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                Dismiss
                            </button>
                            <button
                                onClick={() => navigate(`/${activeRoom}`)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-md transition-colors"
                            >
                                Rejoin
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Create + Lobby table ─────────────────────────────────────── */}
                <div className="space-y-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold">Open Lobbies</h3>
                            {lastRefreshed && (
                                <p className="text-xs text-gray-500">
                                    Updated {lastRefreshed.toLocaleTimeString()}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={fetchLobbies}
                                className="text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                Refresh
                            </button>
                            <button
                                onClick={handleCreateGame}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md transition-colors"
                            >
                                + Create Game
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                        {loading ? (
                            <div className="py-16 text-center text-gray-500">Loading...</div>
                        ) : lobbies.length === 0 ? (
                            <div className="py-16 text-center space-y-2">
                                <p className="text-gray-400">No open lobbies right now.</p>
                                <p className="text-gray-500 text-sm">Be the first — create a game!</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700 text-gray-400 text-left">
                                        <th className="px-5 py-3 font-medium">Code</th>
                                        <th className="px-5 py-3 font-medium">Host</th>
                                        <th className="px-5 py-3 font-medium">Players</th>
                                        <th className="px-5 py-3 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lobbies.map((lobby, i) => (
                                        <tr
                                            key={lobby.code}
                                            className={`${i !== lobbies.length - 1 ? "border-b border-gray-700" : ""} hover:bg-gray-750 transition-colors`}
                                        >
                                            <td className="px-5 py-4 font-mono text-white">
                                                {lobby.code}
                                            </td>
                                            <td className="px-5 py-4 text-gray-300">
                                                {lobby.ownerUsername}
                                            </td>
                                            <td className="px-5 py-4 text-gray-300">
                                                {lobby.playerCount} / {lobby.maxPlayers}
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <button
                                                    onClick={() => navigate(`/${lobby.code}`)}
                                                    className="px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-semibold rounded-md transition-colors"
                                                >
                                                    Join
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </main>

            {showBoard && (
                <div
                    className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
                    onClick={() => setShowBoard(false)}
                >
                    <div
                        className="bg-gray-950 border border-gray-800 rounded-2xl p-5 max-w-3xl w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-bold">City Board</h2>
                            <button
                                onClick={() => setShowBoard(false)}
                                className="text-gray-500 hover:text-white text-xl leading-none"
                            >
                                ✕
                            </button>
                        </div>
                        <CityBoard />
                    </div>
                </div>
            )}

            {showBidBoard && (
                <div
                    className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
                    onClick={() => setShowBidBoard(false)}
                >
                    <div
                        className="bg-gray-950 border border-gray-800 rounded-2xl p-5 max-w-4xl w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-lg font-bold">Bid Board Reference</h2>
                                <p className="text-xs text-gray-500 mt-0.5">Read-only — shows all bid spaces, rewards, and restrictions</p>
                            </div>
                            <button
                                onClick={() => setShowBidBoard(false)}
                                className="text-gray-500 hover:text-white text-xl leading-none"
                            >
                                ✕
                            </button>
                        </div>
                        <BidBoardNew />
                    </div>
                </div>
            )}
        </div>
    );
}
