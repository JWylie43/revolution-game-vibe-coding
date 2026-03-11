// pages/LobbyView.tsx
//
// Waiting room UI — shown while players are gathering before the game starts.
// Receives all state and callbacks as props from GameRoomPage.

import type { PlayerInfo } from "../../../server/src/socket/types.js";

const MAX_PLAYERS = 4;

interface Props {
    code: string;
    players: PlayerInfo[];
    ownerId: string | null;
    countdown: number | null;
    userId: string | undefined;
    isMyPlayerReady: boolean;
    isOwner: boolean;
    onReady: () => void;
    onKick: (targetUserId: string) => void;
}

export default function LobbyView({
    code,
    players,
    ownerId,
    countdown,
    userId,
    isMyPlayerReady,
    isOwner,
    onReady,
    onKick,
}: Props) {
    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
            <div className="bg-gray-800 rounded-lg p-8 w-full max-w-lg">
                {/* Header */}
                <div className="mb-6">
                    <h2 className="text-2xl font-bold mb-1">Game Lobby</h2>
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-gray-400 text-sm">
                            Share code:{" "}
                            <span className="font-mono text-white bg-gray-700 px-2 py-0.5 rounded">
                                {code}
                            </span>
                        </span>
                        <span className="text-gray-500 text-sm">
                            {players.length}/{MAX_PLAYERS} players
                        </span>
                    </div>
                </div>

                {/* Countdown Banner */}
                {countdown !== null && (
                    <div className="bg-green-900/50 border border-green-500 rounded-lg px-4 py-3 mb-6 text-center">
                        <span className="text-green-300 font-semibold">
                            Game starting in{" "}
                            <span className="text-white text-xl font-mono">{countdown}</span>s...
                        </span>
                    </div>
                )}

                {/* Player List */}
                <div className="space-y-2 mb-8">
                    {players.map((player) => (
                        <div
                            key={player.userId}
                            className="flex items-center justify-between bg-gray-700 rounded px-4 py-3"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center font-semibold text-sm">
                                    {player.username[0].toUpperCase()}
                                </div>
                                <div>
                                    <span className="font-medium">
                                        {player.username}
                                        {player.userId === userId && (
                                            <span className="ml-2 text-xs text-gray-400">
                                                (you)
                                            </span>
                                        )}
                                        {player.userId === ownerId && (
                                            <span className="ml-2 text-xs text-yellow-400">
                                                owner
                                            </span>
                                        )}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-sm font-medium ${player.isReady ? "text-green-400" : "text-gray-400"}`}
                                >
                                    {player.isReady ? "Ready" : "Not ready"}
                                </span>
                                {isOwner && player.userId !== userId && (
                                    <button
                                        onClick={() => onKick(player.userId)}
                                        className="text-xs text-red-400 hover:text-red-300 ml-2 px-2 py-1 border border-red-800 rounded hover:border-red-600 transition-colors"
                                    >
                                        Kick
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Empty slots */}
                    {Array.from({ length: MAX_PLAYERS - players.length }).map((_, i) => (
                        <div
                            key={`empty-${i}`}
                            className="flex items-center bg-gray-700/50 rounded px-4 py-3 text-gray-500 italic"
                        >
                            Waiting for player...
                        </div>
                    ))}
                </div>

                {/* Ready Button */}
                <button
                    onClick={onReady}
                    className={`w-full py-3 font-semibold rounded-md transition-colors ${
                        isMyPlayerReady
                            ? "bg-gray-600 hover:bg-gray-500 text-white"
                            : "bg-green-600 hover:bg-green-500 text-white"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {isMyPlayerReady ? "Unready" : "Ready Up"}
                </button>

                <p className="text-xs text-gray-500 text-center mt-3">
                    Need at least 2 players. Game starts when everyone is ready.
                </p>
            </div>
        </div>
    );
}
