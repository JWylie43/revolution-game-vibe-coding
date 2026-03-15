// pages/HistoryPage.tsx
//
// Shows the current user's completed game history.
//   - List view:    game cards with players, scores, winner, date.
//   - Detail modal: round-by-round bid breakdown, score deltas, special actions.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import api from "../services/api";
import { BID_SPACE_ORDER } from "../components/BidBoard";
import HowToPlayDialog from "../components/HowToPlayDialog";

// ── Types ──────────────────────────────────────────────────────────────────────

interface HistoryPlayer {
    userId:     string;
    username:   string;
    score:      number;
    seatNumber: number;
}

interface GameSummary {
    id:         string;
    code:       string;
    playedAt:   string;   // ISO date string from server
    durationMs: number;
    finalState: {
        players: HistoryPlayer[];
        winner:  string | null;
    };
}

interface BlockBid {
    userId:    string;
    username:  string;
    gold:      number;
    blackmail: number;
    force:     number;
}

interface BlockResult {
    blockId:         string;
    winnerUserId:    string | null;
    winnerUsername:  string | null;
    support:         number;
    gold:            number;
    blackmail:       number;
    force:           number;
    special:         "spy" | "apothecary" | null;
    bids:            BlockBid[];
}

interface SpecialAction {
    type:     string;
    userId:   string;
    username: string;
    skipped:  boolean;
    spyTarget?: { previousUsername: string };
    apothecarySwap?: {
        slotA: { username: string };
        slotB: { username: string };
    };
}

interface RoundSnapshot {
    roundNumber:    number;
    results:        BlockResult[];
    specialActions: SpecialAction[];
    playerScores:   Array<{ userId: string; username: string; score: number }>;
}

interface GameDetail extends GameSummary {
    roundHistory: RoundSnapshot[] | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

// Must match SEAT_COLORS in GameView.tsx / SEAT_HEX in CityBoard.tsx
const SEAT_TEXT = [
    "text-blue-400",
    "text-emerald-400",
    "text-orange-400",
    "text-pink-400",
    "text-cyan-400",
    "text-rose-400",
];
const SEAT_BG = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-cyan-500",
    "bg-rose-500",
];

const BID_SPACE_NAMES: Record<string, string> = {
    general:    "General",
    captain:    "Captain",
    innkeeper:  "Innkeeper",
    magistrate: "Magistrate",
    priest:     "Priest",
    aristocrat: "Aristocrat",
    merchant:   "Merchant",
    printer:    "Printer",
    rogue:      "Rogue",
    spy:        "Spy",
    apothecary: "Apothecary",
    mercenary:  "Mercenary",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBid(gold: number, blackmail: number, force: number): string {
    const parts: string[] = [];
    if (gold      > 0) parts.push(`${gold}G`);
    if (blackmail > 0) parts.push(`${blackmail}B`);
    if (force     > 0) parts.push(`${force}F`);
    return parts.length > 0 ? parts.join(" ") : "—";
}

function fmtDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m === 0) return `${s}s`;
    return `${m}m ${s % 60}s`;
}

function fmtDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Score delta per player between two consecutive snapshots (or from 0 for round 1). */
function buildDeltas(
    current:  Array<{ userId: string; score: number }>,
    previous: Array<{ userId: string; score: number }> | null,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of current) {
        const prev = previous?.find((x) => x.userId === p.userId)?.score ?? 0;
        out[p.userId] = p.score - prev;
    }
    return out;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PlayerDot({ colorIdx }: { colorIdx: number }) {
    return (
        <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${SEAT_BG[colorIdx % SEAT_BG.length]}`}
        />
    );
}

// ── Bid table for one round ────────────────────────────────────────────────────

function RoundBidTable({
    snapshot,
    players,
    colorMap,
    prevSnapshot,
}: {
    snapshot:     RoundSnapshot;
    players:      HistoryPlayer[];
    colorMap:     Record<string, number>;
    prevSnapshot: RoundSnapshot | null;
}) {
    // Build lookup: blockId → BlockResult
    const resultMap: Record<string, BlockResult> = {};
    for (const r of snapshot.results) resultMap[r.blockId] = r;

    // Score deltas
    const deltas = buildDeltas(snapshot.playerScores, prevSnapshot?.playerScores ?? null);

    return (
        <div className="space-y-5">

            {/* ── Bid grid ───────────────────────────────────────────────────── */}
            <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-gray-800 border-b border-gray-700">
                            <th className="px-3 py-2 text-left font-semibold text-gray-400 w-28">Space</th>
                            {players.map((p) => {
                                const ci = colorMap[p.userId] ?? 0;
                                return (
                                    <th key={p.userId} className="px-3 py-2 text-center font-medium">
                                        <span className="flex items-center justify-center gap-1">
                                            <PlayerDot colorIdx={ci} />
                                            <span className={SEAT_TEXT[ci % SEAT_TEXT.length]}>
                                                {p.username}
                                            </span>
                                        </span>
                                    </th>
                                );
                            })}
                            <th className="px-3 py-2 text-center font-semibold text-gray-400">Winner</th>
                        </tr>
                    </thead>
                    <tbody>
                        {BID_SPACE_ORDER.map((spaceId, i) => {
                            const result = resultMap[spaceId];
                            const isLast = i === BID_SPACE_ORDER.length - 1;
                            const rowBase = `${!isLast ? "border-b border-gray-800" : ""} hover:bg-gray-800/40 transition-colors`;

                            return (
                                <tr key={spaceId} className={rowBase}>
                                    {/* Space name */}
                                    <td className="px-3 py-2 font-medium text-gray-300">
                                        {BID_SPACE_NAMES[spaceId] ?? spaceId}
                                    </td>

                                    {/* Each player's bid on this space */}
                                    {players.map((p) => {
                                        const bid = result?.bids.find((b) => b.userId === p.userId);
                                        const isWinner = result?.winnerUserId === p.userId;
                                        const ci = colorMap[p.userId] ?? 0;
                                        return (
                                            <td
                                                key={p.userId}
                                                className={`px-3 py-2 text-center font-mono ${
                                                    isWinner
                                                        ? `${SEAT_TEXT[ci % SEAT_TEXT.length]} font-semibold bg-gray-800/50`
                                                        : "text-gray-500"
                                                }`}
                                            >
                                                {bid
                                                    ? fmtBid(bid.gold, bid.blackmail, bid.force)
                                                    : "—"}
                                            </td>
                                        );
                                    })}

                                    {/* Winner + support gained */}
                                    <td className="px-3 py-2 text-center">
                                        {result?.winnerUserId ? (
                                            <span className="flex items-center justify-center gap-1.5">
                                                <PlayerDot colorIdx={colorMap[result.winnerUserId] ?? 0} />
                                                <span className={`font-medium ${SEAT_TEXT[(colorMap[result.winnerUserId] ?? 0) % SEAT_TEXT.length]}`}>
                                                    {result.winnerUsername}
                                                </span>
                                                {result.support > 0 && (
                                                    <span className="text-yellow-500 font-bold">
                                                        +{result.support}
                                                    </span>
                                                )}
                                                {result.special && (
                                                    <span className="text-amber-400 text-[10px]">
                                                        {result.special === "spy" ? "🕵️" : "⚗️"}
                                                    </span>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="text-gray-600 text-[11px]">no winner</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Special actions ────────────────────────────────────────────── */}
            {snapshot.specialActions?.length > 0 && (
                <div className="space-y-1.5">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/70">
                        Special Actions
                    </h4>
                    <div className="space-y-1">
                        {snapshot.specialActions.map((sa, idx) => {
                            const ci = colorMap[sa.userId] ?? 0;
                            return (
                                <div
                                    key={idx}
                                    className="flex items-start gap-2 text-xs bg-gray-800/50 rounded px-3 py-2"
                                >
                                    <span>{sa.type === "spy" ? "🕵️" : "⚗️"}</span>
                                    <span>
                                        <span className={`font-semibold ${SEAT_TEXT[ci % SEAT_TEXT.length]}`}>
                                            {sa.username}
                                        </span>
                                        {sa.skipped ? (
                                            <span className="text-gray-500"> skipped their {sa.type} action</span>
                                        ) : sa.type === "spy" && sa.spyTarget ? (
                                            <span className="text-gray-300">
                                                {" "}replaced{" "}
                                                <span className="text-gray-400 font-medium">
                                                    {sa.spyTarget.previousUsername}
                                                </span>
                                                {"'s cube with their own"}
                                            </span>
                                        ) : sa.type === "apothecary" && sa.apothecarySwap ? (
                                            <span className="text-gray-300">
                                                {" "}swapped cubes between{" "}
                                                <span className="text-gray-400 font-medium">
                                                    {sa.apothecarySwap.slotA.username}
                                                </span>
                                                {" and "}
                                                <span className="text-gray-400 font-medium">
                                                    {sa.apothecarySwap.slotB.username}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="text-gray-500"> used {sa.type}</span>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Score summary for this round ───────────────────────────────── */}
            <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Score after Round {snapshot.roundNumber}
                </h4>
                <div className="flex flex-wrap gap-3">
                    {[...snapshot.playerScores]
                        .sort((a, b) => b.score - a.score)
                        .map((ps) => {
                            const ci    = colorMap[ps.userId] ?? 0;
                            const delta = deltas[ps.userId] ?? 0;
                            return (
                                <div
                                    key={ps.userId}
                                    className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2"
                                >
                                    <PlayerDot colorIdx={ci} />
                                    <span className={`text-xs font-medium ${SEAT_TEXT[ci % SEAT_TEXT.length]}`}>
                                        {ps.username}
                                    </span>
                                    <span className="text-sm font-bold text-white">{ps.score}</span>
                                    {delta !== 0 && (
                                        <span className={`text-[11px] font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {delta > 0 ? `+${delta}` : delta}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                </div>
            </div>

        </div>
    );
}

// ── Detail modal ───────────────────────────────────────────────────────────────

function GameDetailModal({
    game,
    onClose,
}: {
    game:    GameDetail;
    onClose: () => void;
}) {
    const [activeRound, setActiveRound] = useState(0);

    const { players, winner } = game.finalState;
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    // Build userId → color index map (by seat number)
    const colorMap: Record<string, number> = {};
    for (const p of players) colorMap[p.userId] = p.seatNumber % SEAT_BG.length;

    const rounds = game.roundHistory ?? [];
    const current = rounds[activeRound] ?? null;
    const prev    = activeRound > 0 ? rounds[activeRound - 1] : null;

    // Close on backdrop click
    function handleBackdrop(e: React.MouseEvent) {
        if (e.target === e.currentTarget) onClose();
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
            onClick={handleBackdrop}
        >
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl">

                {/* ── Modal header ─────────────────────────────────────────── */}
                <div className="shrink-0 bg-gray-800 rounded-t-2xl px-6 py-4 border-b border-gray-700">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5">
                            {/* Game code + meta */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="font-mono text-lg font-bold text-white">{game.code}</span>
                                <span className="text-gray-500 text-sm">
                                    {fmtDate(game.playedAt)} at {fmtTime(game.playedAt)}
                                </span>
                                <span className="text-gray-600 text-sm">
                                    {rounds.length} round{rounds.length !== 1 ? "s" : ""}
                                </span>
                                {game.durationMs > 0 && (
                                    <span className="text-gray-600 text-sm">{fmtDuration(game.durationMs)}</span>
                                )}
                            </div>

                            {/* Player scores */}
                            <div className="flex items-center gap-4 flex-wrap">
                                {sortedPlayers.map((p) => {
                                    const ci       = colorMap[p.userId] ?? 0;
                                    const isWinner = p.userId === winner;
                                    return (
                                        <span key={p.userId} className="flex items-center gap-1.5">
                                            {isWinner && <span className="text-yellow-400 text-sm">🏆</span>}
                                            <PlayerDot colorIdx={ci} />
                                            <span className={`text-sm font-medium ${SEAT_TEXT[ci % SEAT_TEXT.length]}`}>
                                                {p.username}
                                            </span>
                                            <span className={`text-sm font-bold ${isWinner ? "text-yellow-400" : "text-gray-400"}`}>
                                                {p.score}
                                            </span>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="shrink-0 text-gray-500 hover:text-white text-2xl leading-none transition-colors"
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Round tabs */}
                    {rounds.length > 0 && (
                        <div className="flex gap-1 mt-4 flex-wrap">
                            {rounds.map((r, i) => (
                                <button
                                    key={r.roundNumber}
                                    onClick={() => setActiveRound(i)}
                                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                                        activeRound === i
                                            ? "bg-indigo-600 text-white"
                                            : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                                    }`}
                                >
                                    Round {r.roundNumber}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Modal body (scrollable) ───────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {rounds.length === 0 ? (
                        <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
                            No round history recorded for this game.
                        </div>
                    ) : current ? (
                        <RoundBidTable
                            key={activeRound}
                            snapshot={current}
                            players={[...players].sort((a, b) => a.seatNumber - b.seatNumber)}
                            colorMap={colorMap}
                            prevSnapshot={prev}
                        />
                    ) : null}
                </div>

            </div>
        </div>
    );
}

// ── Game card ──────────────────────────────────────────────────────────────────

function GameCard({
    game,
    currentUserId,
    onViewDetail,
    loadingId,
}: {
    game:          GameSummary;
    currentUserId: string;
    onViewDetail:  (id: string) => void;
    loadingId:     string | null;
}) {
    const { players, winner } = game.finalState;
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    // userId → color index
    const colorMap: Record<string, number> = {};
    for (const p of players) colorMap[p.userId] = p.seatNumber % SEAT_BG.length;

    const isLoading = loadingId === game.id;

    return (
        <div className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-gray-600 transition-colors">

            {/* Left: code + date + round count */}
            <div className="shrink-0 w-40">
                <p className="font-mono font-bold text-white text-base">{game.code}</p>
                <p className="text-gray-500 text-xs mt-0.5">{fmtDate(game.playedAt)}</p>
                {game.durationMs > 0 && (
                    <p className="text-gray-600 text-xs">{fmtDuration(game.durationMs)}</p>
                )}
            </div>

            {/* Middle: player list */}
            <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {sortedPlayers.map((p) => {
                    const ci       = colorMap[p.userId] ?? 0;
                    const isWinner = p.userId === winner;
                    const isMe     = p.userId === currentUserId;
                    return (
                        <span key={p.userId} className="flex items-center gap-1.5 text-sm">
                            {isWinner && <span className="text-yellow-400">🏆</span>}
                            <PlayerDot colorIdx={ci} />
                            <span className={`font-medium ${SEAT_TEXT[ci % SEAT_TEXT.length]}`}>
                                {p.username}
                                {isMe && <span className="text-gray-600 ml-1 text-xs">(you)</span>}
                            </span>
                            <span className={`font-bold ${isWinner ? "text-yellow-400" : "text-gray-400"}`}>
                                {p.score}
                            </span>
                        </span>
                    );
                })}
            </div>

            {/* Right: details button */}
            <button
                onClick={() => onViewDetail(game.id)}
                disabled={isLoading}
                className="shrink-0 px-4 py-2 bg-gray-700 hover:bg-indigo-600 disabled:opacity-50 text-gray-300 hover:text-white text-sm font-semibold rounded-lg transition-colors"
            >
                {isLoading ? "Loading…" : "View Details"}
            </button>
        </div>
    );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
    const { user, logout } = useAuthStore();
    const navigate = useNavigate();

    const [games,       setGames]       = useState<GameSummary[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState<string | null>(null);
    const [loadingId,   setLoadingId]   = useState<string | null>(null);
    const [detailGame,  setDetailGame]  = useState<GameDetail | null>(null);
    const [showHowTo,   setShowHowTo]   = useState(false);

    // Load list on mount
    useEffect(() => {
        api.get<{ games: GameSummary[] }>("/history")
            .then(({ data }) => setGames(data.games))
            .catch(() => setError("Failed to load game history"))
            .finally(() => setLoading(false));
    }, []);

    const openDetail = useCallback(async (id: string) => {
        setLoadingId(id);
        try {
            const { data } = await api.get<{ game: GameDetail }>(`/history/${id}`);
            setDetailGame(data.game);
        } catch {
            setError("Failed to load game details");
        } finally {
            setLoadingId(null);
        }
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white">

            {/* ── Nav ──────────────────────────────────────────────────────── */}
            <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate("/")}
                            className="font-bold text-xl hover:text-indigo-400 transition-colors"
                        >
                            Revolution
                        </button>
                        <span className="text-gray-600">/</span>
                        <span className="text-gray-400 text-sm font-medium">Game History</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <span className="text-gray-400 text-sm">
                            <span className="text-white font-medium">{user?.username}</span>
                        </span>
                        <button
                            onClick={() => setShowHowTo(true)}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            How to Play
                        </button>
                        <button
                            onClick={() => navigate("/")}
                            className="text-sm text-gray-400 hover:text-white transition-colors"
                        >
                            ← Home
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

            {/* ── Main ─────────────────────────────────────────────────────── */}
            <main className="max-w-4xl mx-auto px-6 py-10 space-y-4">

                <div>
                    <h2 className="text-2xl font-bold">Your Games</h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Every completed game you participated in, newest first.
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                {/* Loading skeleton */}
                {loading && (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-20 animate-pulse" />
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!loading && !error && games.length === 0 && (
                    <div className="bg-gray-800 border border-gray-700 rounded-xl py-16 text-center space-y-2">
                        <p className="text-gray-400">No completed games yet.</p>
                        <p className="text-gray-600 text-sm">Finish a game to see it here.</p>
                        <button
                            onClick={() => navigate("/")}
                            className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                            Play a game
                        </button>
                    </div>
                )}

                {/* Game list */}
                {!loading && games.length > 0 && (
                    <div className="space-y-3">
                        {games.map((g) => (
                            <GameCard
                                key={g.id}
                                game={g}
                                currentUserId={user?.id ?? ""}
                                onViewDetail={openDetail}
                                loadingId={loadingId}
                            />
                        ))}
                    </div>
                )}

            </main>

            {/* ── Detail modal ─────────────────────────────────────────────── */}
            {detailGame && (
                <GameDetailModal
                    game={detailGame}
                    onClose={() => setDetailGame(null)}
                />
            )}

            {showHowTo && <HowToPlayDialog onClose={() => setShowHowTo(false)} />}

        </div>
    );
}
