// pages/LobbyPage.tsx
//
// The home screen: create a game or enter a code to join one.
// This page does NOT touch the socket — it just navigates to /:code
// once it has a valid code. The LobbyRoomPage handles all socket logic.
//
// Routes:
//   Create: POST /api/lobby/create → { code } → navigate /lobby/:code
//   Join:   Enter code manually → navigate /lobby/:code (socket will validate on arrival)

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

// Generates a random memorable code like "blue1234".
// The server will create the lobby when the first player joins via socket.
const COLORS = ["red", "blue", "green", "gold", "purple", "orange", "silver", "black", "teal"];
function generateCode(): string {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  return `${color}${digits}`;
}

export default function HomePage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // ── Create a new game ──────────────────────────────────────────────────────
  // No server call needed — navigating to the URL creates the lobby on arrival.
  const handleCreateGame = () => {
    navigate(`/${generateCode()}`);
  };

  // ── Join by code ───────────────────────────────────────────────────────────
  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();

    if (!code) {
      setJoinError("Enter a game code");
      return;
    }

    // Matches server validation: lowercase alphanumeric, 3–32 chars
    if (!/^[a-z0-9]{3,32}$/.test(code)) {
      setJoinError("Code must be 3–32 letters/numbers (e.g. blue1234)");
      return;
    }

    navigate(`/${code}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* ── Navigation Bar ─────────────────────────────────────────────────── */}
      <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Revolution</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-400">
              Welcome, <span className="text-white font-medium">{user?.username}</span>
            </span>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-2">Play Revolution</h2>
          <p className="text-gray-400">Bid for control. Seize the city.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ── Create Game ──────────────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-2">Create Game</h3>
            <p className="text-gray-400 text-sm mb-6">
              Start a new lobby. Share the code with friends to invite them.
            </p>

            <button
              onClick={handleCreateGame}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-md transition-colors"
            >
              Create New Game
            </button>
          </div>

          {/* ── Join Game ─────────────────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-2">Join Game</h3>
            <p className="text-gray-400 text-sm mb-6">
              Enter a game code to join a friend's game.
            </p>

            {joinError && (
              <div className="bg-red-900/50 border border-red-500 text-red-200 px-3 py-2 rounded text-sm mb-4">
                {joinError}
              </div>
            )}

            <form onSubmit={handleJoinGame} className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value.toLowerCase());
                  setJoinError(null);
                }}
                placeholder="blue1234"
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
              >
                Join
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
