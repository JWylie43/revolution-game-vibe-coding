// pages/GameView.tsx

import { useState, useMemo, useEffect } from "react";
import type { GameState, BidSubmission, BlockResult } from "../../../server/src/socket/types.js";
import socket from "../services/socket.js";
import CityBoard from "../components/CityBoard.js";

interface Props {
    gameState: GameState;
    userId: string;
}

// One color per seat — used for influence block dots on the board and sidebar
const SEAT_COLORS = [
    { bg: "bg-blue-500",    ring: "ring-blue-400",    dot: "#3b82f6" },
    { bg: "bg-emerald-500", ring: "ring-emerald-400", dot: "#10b981" },
    { bg: "bg-orange-500",  ring: "ring-orange-400",  dot: "#f97316" },
    { bg: "bg-pink-500",    ring: "ring-pink-400",    dot: "#ec4899" },
    { bg: "bg-cyan-500",    ring: "ring-cyan-400",    dot: "#06b6d4" },
    { bg: "bg-rose-500",    ring: "ring-rose-400",    dot: "#f43f5e" },
];

// ── Bid space card styling ──────────────────────────────────────────────────────
// Matches the physical board: red = No Force, dark = No Blackmail, brown = open
function bidCardStyle(noForce: boolean, noBlackmail: boolean): string {
    if (noForce)     return "border-red-800/70 bg-red-950/40";
    if (noBlackmail) return "border-gray-600/70 bg-gray-900/60";
    return "border-amber-900/50 bg-amber-950/25";
}

type BidMap = Record<string, { gold: number; blackmail: number; force: number }>;

function emptyBids(spaces: string[]): BidMap {
    return Object.fromEntries(spaces.map((id) => [id, { gold: 0, blackmail: 0, force: 0 }]));
}

// The canonical order bid spaces appear on the physical board (row by row, left to right)
const BID_SPACE_ORDER = [
    "general", "captain", "innkeeper", "magistrate",
    "priest", "aristocrat", "merchant", "printer",
    "rogue", "spy", "apothecary", "mercenary",
];

// Static display metadata (descriptions + reward labels) — doesn't come from server
const BID_SPACE_META: Record<string, {
    noForce: boolean;
    noBlackmail: boolean;
    rewardLabel: string;
    influenceLabel: string | null;
}> = {
    general:    { noForce: true,  noBlackmail: false, rewardLabel: "1 support + 1 force",      influenceLabel: "Fortress" },
    captain:    { noForce: true,  noBlackmail: false, rewardLabel: "1 support + 1 force",      influenceLabel: "Harbor" },
    innkeeper:  { noForce: false, noBlackmail: true,  rewardLabel: "3 support + 1 blackmail",  influenceLabel: "Tavern" },
    magistrate: { noForce: false, noBlackmail: true,  rewardLabel: "1 support + 1 blackmail",  influenceLabel: "Town Hall" },
    priest:     { noForce: false, noBlackmail: false, rewardLabel: "6 support",                influenceLabel: "Cathedral" },
    aristocrat: { noForce: false, noBlackmail: false, rewardLabel: "5 support + 3 gold",       influenceLabel: "Plantation" },
    merchant:   { noForce: false, noBlackmail: false, rewardLabel: "3 support + 5 gold",       influenceLabel: "Market" },
    printer:    { noForce: false, noBlackmail: false, rewardLabel: "10 support",               influenceLabel: null },
    rogue:      { noForce: true,  noBlackmail: false, rewardLabel: "2 blackmail",              influenceLabel: null },
    spy:        { noForce: false, noBlackmail: true,  rewardLabel: "Replace an influence cube", influenceLabel: null },
    apothecary: { noForce: true,  noBlackmail: false, rewardLabel: "Swap two influence cubes", influenceLabel: null },
    mercenary:  { noForce: true,  noBlackmail: false, rewardLabel: "3 support + 1 force",      influenceLabel: null },
};

export default function GameView({ gameState, userId }: Props) {
    const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
    const myPlayer = gameState.players.find((p) => p.userId === userId);
    const isSpectator = !myPlayer;

    // Assign each player a stable color based on seat number
    const playerColorMap = useMemo(() => {
        const map: Record<string, number> = {};
        for (const p of gameState.players) {
            map[p.userId] = p.seatNumber % SEAT_COLORS.length;
        }
        return map;
    }, [gameState.players]);

    // ── Bid state ──────────────────────────────────────────────────────────────
    const [bids, setBids] = useState<BidMap>(() => emptyBids(BID_SPACE_ORDER));
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [showBoard, setShowBoard] = useState(false);
    const [showResults, setShowResults] = useState(false);

    // Reset bids when a new round starts
    useEffect(() => {
        setBids(emptyBids(BID_SPACE_ORDER));
        setSubmitError(null);
        setShowResults(false);
    }, [gameState.roundNumber]);

    // Auto-show results when round resolves
    useEffect(() => {
        if (gameState.phase === "ROUND_OVER" && gameState.lastRoundResults) {
            setShowResults(true);
        }
    }, [gameState.phase]);

    const spent = useMemo(() => {
        let gold = 0, blackmail = 0, force = 0;
        for (const b of Object.values(bids)) {
            gold += b.gold;
            blackmail += b.blackmail;
            force += b.force;
        }
        return { gold, blackmail, force };
    }, [bids]);

    const maxTokens = {
        gold:      myPlayer?.goldTokens ?? 0,
        blackmail: myPlayer?.blackmailTokens ?? 0,
        force:     myPlayer?.forceTokens ?? 0,
    };

    const remaining = {
        gold:      maxTokens.gold      - spent.gold,
        blackmail: maxTokens.blackmail - spent.blackmail,
        force:     maxTokens.force     - spent.force,
    };

    function changeBid(spaceId: string, type: "gold" | "blackmail" | "force", delta: number) {
        const meta = BID_SPACE_META[spaceId];
        if (delta > 0) {
            if (type === "force"     && meta?.noForce)     return;
            if (type === "blackmail" && meta?.noBlackmail) return;
            if (remaining[type] <= 0) return;
        }
        setBids((prev) => {
            const cur = prev[spaceId] ?? { gold: 0, blackmail: 0, force: 0 };
            return { ...prev, [spaceId]: { ...cur, [type]: Math.max(0, cur[type] + delta) } };
        });
    }

    function handleSubmit() {
        // All tokens must be spent before locking in
        if (remaining.gold > 0 || remaining.blackmail > 0 || remaining.force > 0) {
            setSubmitError(
                `Spend all tokens first — ${remaining.gold}G ${remaining.blackmail}B ${remaining.force}F remaining`
            );
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        const bidList: BidSubmission[] = BID_SPACE_ORDER.map((id) => ({
            blockId: id,
            ...(bids[id] ?? { gold: 0, blackmail: 0, force: 0 }),
        }));
        socket.emit("game:submitBids", { bids: bidList }, (res) => {
            setSubmitting(false);
            if (!res.success) setSubmitError(res.error ?? "Failed to submit bids");
        });
    }

    const isBidPhase       = gameState.phase === "BID_PHASE";
    const alreadySubmitted = myPlayer?.hasSubmittedBids ?? false;
    const canBid           = isBidPhase && !alreadySubmitted && !isSpectator;

    return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col">

            {/* ── Header ──────────────────────────────────────────────────────── */}
            <header className="flex items-center justify-between px-5 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="font-bold text-base tracking-wide">Revolution!</h1>
                    <span className="text-sm text-gray-500">Round {gameState.roundNumber} / 5</span>
                    <PhaseBadge phase={gameState.phase} />
                </div>

                <div className="flex items-center gap-4">
                    {/* Token budget */}
                    {canBid && (
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-gray-600 text-xs">Left:</span>
                            <BudgetPill value={remaining.gold}      color="text-yellow-400" symbol="G" label="Gold" />
                            <BudgetPill value={remaining.blackmail} color="text-purple-400" symbol="B" label="Blackmail" />
                            <BudgetPill value={remaining.force}     color="text-red-400"    symbol="F" label="Force" />
                        </div>
                    )}

                    {/* Game board button */}
                    <button
                        onClick={() => setShowBoard(true)}
                        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
                    >
                        View Board
                    </button>
                </div>
            </header>

            {/* ── Body ─────────────────────────────────────────────────────────── */}
            <div className="flex flex-1 overflow-hidden">

                {/* ── Bid board ────────────────────────────────────────────────── */}
                <main className="flex-1 overflow-y-auto p-4">

                    {/* Phase banners */}
                    {gameState.phase === "RESOLVING" && (
                        <div className="mb-4 text-center text-yellow-400 font-semibold animate-pulse">
                            Resolving bids…
                        </div>
                    )}
                    {gameState.phase === "GAME_OVER" && (
                        <div className="mb-4 text-center">
                            <p className="text-3xl font-bold text-yellow-400">Revolution is over!</p>
                            {gameState.winner && (
                                <p className="text-gray-300 mt-1">
                                    Winner:{" "}
                                    {gameState.players.find((p) => p.userId === gameState.winner)?.username
                                        ?? gameState.winner}
                                </p>
                            )}
                        </div>
                    )}

                    {/* 4×3 bid board grid */}
                    <div className="grid grid-cols-4 gap-2 max-w-4xl mx-auto">
                        {BID_SPACE_ORDER.map((spaceId) => {
                            const meta  = BID_SPACE_META[spaceId];
                            const bid   = bids[spaceId] ?? { gold: 0, blackmail: 0, force: 0 };
                            const style = bidCardStyle(meta.noForce, meta.noBlackmail);

                            // Find this space's result from last round
                            const lastResult = gameState.lastRoundResults?.find((r) => r.blockId === spaceId);
                            const winner     = lastResult?.winnerUsername;

                            return (
                                <div key={spaceId} className={`rounded-lg border p-3 flex flex-col gap-2 ${style}`}>
                                    {/* Name */}
                                    <div className="flex items-start justify-between gap-1">
                                        <span className="font-bold text-sm leading-tight uppercase tracking-wide">
                                            {spaceId.charAt(0).toUpperCase() + spaceId.slice(1).replace("_", " ")}
                                        </span>
                                        {/* Restriction badges */}
                                        <div className="flex gap-1 shrink-0">
                                            {meta.noForce     && <span className="text-[10px] px-1 py-0.5 bg-red-900/70 text-red-300 rounded" title="Cannot bid Force">No F</span>}
                                            {meta.noBlackmail && <span className="text-[10px] px-1 py-0.5 bg-gray-800 text-gray-300 rounded" title="Cannot bid Blackmail">No B</span>}
                                        </div>
                                    </div>

                                    {/* Rewards */}
                                    <div className="text-xs text-gray-300 leading-tight">{meta.rewardLabel}</div>
                                    {meta.influenceLabel && (
                                        <div className="text-xs text-indigo-400 leading-tight">
                                            → {meta.influenceLabel}
                                        </div>
                                    )}

                                    {/* Last round winner */}
                                    {gameState.phase === "ROUND_OVER" && lastResult && (
                                        <div className="text-xs mt-auto">
                                            {winner ? (
                                                <span className="text-emerald-400">Won: {winner}</span>
                                            ) : (
                                                <span className="text-gray-600 italic">Contested</span>
                                            )}
                                        </div>
                                    )}

                                    {/* Bid controls */}
                                    {canBid && (
                                        <div className="flex gap-1 pt-1.5 border-t border-white/10 mt-auto">
                                            <BidControl
                                                value={bid.gold}
                                                canInc={remaining.gold > 0}
                                                canDec={bid.gold > 0}
                                                onInc={() => changeBid(spaceId, "gold", 1)}
                                                onDec={() => changeBid(spaceId, "gold", -1)}
                                                color="text-yellow-400"
                                                symbol="G"
                                            />
                                            <BidControl
                                                value={bid.blackmail}
                                                canInc={!meta.noBlackmail && remaining.blackmail > 0}
                                                canDec={bid.blackmail > 0}
                                                onInc={() => changeBid(spaceId, "blackmail", 1)}
                                                onDec={() => changeBid(spaceId, "blackmail", -1)}
                                                color={meta.noBlackmail ? "text-gray-600 opacity-40" : "text-purple-400"}
                                                symbol="B"
                                                disabled={meta.noBlackmail}
                                            />
                                            <BidControl
                                                value={bid.force}
                                                canInc={!meta.noForce && remaining.force > 0}
                                                canDec={bid.force > 0}
                                                onInc={() => changeBid(spaceId, "force", 1)}
                                                onDec={() => changeBid(spaceId, "force", -1)}
                                                color={meta.noForce ? "text-gray-600 opacity-40" : "text-red-400"}
                                                symbol="F"
                                                disabled={meta.noForce}
                                            />
                                        </div>
                                    )}

                                    {/* Show placed bids after submit (mine only, others hidden) */}
                                    {isBidPhase && alreadySubmitted && !isSpectator && (
                                        <div className="flex gap-1 pt-1 border-t border-white/10 text-xs opacity-60 mt-auto">
                                            {bid.gold > 0      && <span className="text-yellow-400">G{bid.gold}</span>}
                                            {bid.blackmail > 0 && <span className="text-purple-400">B{bid.blackmail}</span>}
                                            {bid.force > 0     && <span className="text-red-400">F{bid.force}</span>}
                                            {(bid.gold + bid.blackmail + bid.force === 0) && (
                                                <span className="text-gray-700 italic">no bid</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Submit / status row ──────────────────────────────── */}
                    <div className="max-w-4xl mx-auto mt-3 flex items-center gap-4 flex-wrap">
                        {isBidPhase && !isSpectator && (
                            alreadySubmitted ? (
                                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                                    <CheckIcon />
                                    Bids locked in — waiting for others…
                                </div>
                            ) : (
                                <>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={submitting}
                                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
                                    >
                                        {submitting ? "Submitting…" : "Lock In Bids"}
                                    </button>
                                    {submitError && (
                                        <span className="text-red-400 text-sm">{submitError}</span>
                                    )}
                                </>
                            )
                        )}

                        {/* Who has submitted */}
                        {isBidPhase && (
                            <div className="flex items-center gap-3 text-xs ml-auto">
                                {gameState.players.map((p) => {
                                    const ci = playerColorMap[p.userId] ?? 0;
                                    return (
                                        <span key={p.userId} className="flex items-center gap-1">
                                            <span className={`inline-block w-2 h-2 rounded-full ${SEAT_COLORS[ci].bg}`} />
                                            <span className={p.hasSubmittedBids ? "text-emerald-400" : "text-gray-600"}>
                                                {p.username}{p.hasSubmittedBids ? " ✓" : ""}
                                            </span>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </main>

                {/* ── Player sidebar ───────────────────────────────────────── */}
                <aside className="w-48 bg-gray-900 border-l border-gray-800 flex flex-col gap-2 p-3 overflow-y-auto shrink-0">
                    <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
                        Players
                    </h2>
                    {sortedPlayers.map((player) => {
                        const isMe     = player.userId === userId;
                        const ci       = playerColorMap[player.userId] ?? 0;
                        const colors   = SEAT_COLORS[ci];
                        return (
                            <div
                                key={player.userId}
                                className={`rounded-lg p-2.5 flex flex-col gap-1.5 ${
                                    isMe
                                        ? `bg-gray-800 ring-1 ${colors.ring}`
                                        : "bg-gray-800/50"
                                } ${!player.isConnected ? "opacity-40" : ""}`}
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors.bg}`} />
                                        <span className="font-medium text-xs truncate">
                                            {player.username}
                                            {isMe && <span className="ml-1 text-gray-500">(you)</span>}
                                        </span>
                                    </div>
                                    <span className="text-xs text-yellow-400 font-bold shrink-0">
                                        {player.score}
                                    </span>
                                </div>

                                {isBidPhase && (
                                    <span className={`text-[11px] ${player.hasSubmittedBids ? "text-emerald-400" : "text-gray-600"}`}>
                                        {player.hasSubmittedBids ? "✓ locked in" : "bidding…"}
                                    </span>
                                )}

                                {isBidPhase && isMe && (
                                    <div className="flex gap-2 text-xs pt-1 border-t border-gray-700/50">
                                        <TokenBadge count={player.goldTokens}      color="text-yellow-400" symbol="G" label="Gold" />
                                        <TokenBadge count={player.blackmailTokens} color="text-purple-400" symbol="B" label="Blackmail" />
                                        <TokenBadge count={player.forceTokens}     color="text-red-400"    symbol="F" label="Force" />
                                    </div>
                                )}

                                {!player.isConnected && (
                                    <span className="text-[11px] text-gray-600">disconnected</span>
                                )}
                            </div>
                        );
                    })}
                </aside>
            </div>

            {/* ── Game Board Dialog ────────────────────────────────────────────── */}
            {showBoard && (
                <BoardDialog
                    gameState={gameState}
                    playerColorMap={playerColorMap}
                    onClose={() => setShowBoard(false)}
                />
            )}

            {/* ── Round Results Dialog ─────────────────────────────────────────── */}
            {showResults && gameState.lastRoundResults && (
                <ResultsDialog
                    results={gameState.lastRoundResults}
                    gameState={gameState}
                    playerColorMap={playerColorMap}
                    onClose={() => setShowResults(false)}
                />
            )}
        </div>
    );
}

// ── Board Dialog ───────────────────────────────────────────────────────────────

function BoardDialog({
    gameState,
    playerColorMap,
    onClose,
}: {
    gameState: GameState;
    playerColorMap: Record<string, number>;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-gray-950 border border-gray-800 rounded-2xl p-5 max-w-3xl w-full"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">City Board</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
                </div>
                {!gameState.boardLocations ? (
                    <p className="text-yellow-400 text-sm">Board data unavailable — start a new game.</p>
                ) : (
                    <CityBoard locations={gameState.boardLocations} playerColorMap={playerColorMap} />
                )}
            </div>
        </div>
    );
}

// ── Results Dialog ─────────────────────────────────────────────────────────────
// Shows what everyone won last round.

function ResultsDialog({
    results,
    gameState,
    playerColorMap,
    onClose,
}: {
    results: BlockResult[];
    gameState: GameState;
    playerColorMap: Record<string, number>;
    onClose: () => void;
}) {
    const winResults = results.filter((r) => r.winnerUserId !== null);

    return (
        <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold">Round {gameState.roundNumber} Results</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
                </div>

                <div className="flex flex-col gap-2">
                    {winResults.map((r) => {
                        const meta  = BID_SPACE_META[r.blockId];
                        const ci    = r.winnerUserId ? (playerColorMap[r.winnerUserId] ?? 0) : 0;
                        const parts: string[] = [];
                        if (r.support)   parts.push(`${r.support} support`);
                        if (r.gold)      parts.push(`${r.gold} gold`);
                        if (r.blackmail) parts.push(`${r.blackmail} blackmail`);
                        if (r.force)     parts.push(`${r.force} force`);
                        if (r.influenceLocationId) parts.push(`→ ${r.influenceLocationId.replace("_", " ")}`);
                        if (r.special)   parts.push(r.special === "spy" ? "replace a cube" : "swap two cubes");

                        return (
                            <div key={r.blockId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                                <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${SEAT_COLORS[ci].bg}`} />
                                <span className="font-semibold text-sm w-24 shrink-0">
                                    {r.blockId.charAt(0).toUpperCase() + r.blockId.slice(1).replace("_", " ")}
                                </span>
                                <span className="text-sm text-gray-300 shrink-0">
                                    {r.winnerUsername}
                                </span>
                                <span className="text-xs text-gray-500 ml-auto text-right">
                                    {parts.join(" · ")}
                                </span>
                            </div>
                        );
                    })}

                    {results.filter((r) => !r.winnerUserId).length > 0 && (
                        <div className="mt-2 text-xs text-gray-600">
                            Contested (tied):{" "}
                            {results
                                .filter((r) => !r.winnerUserId && r.bids.length > 0)
                                .map((r) => r.blockId)
                                .join(", ") || "none"}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Small components ───────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: GameState["phase"] }) {
    const styles: Record<GameState["phase"], string> = {
        BID_PHASE:  "bg-indigo-800/60 text-indigo-200",
        RESOLVING:  "bg-yellow-700/60 text-yellow-100",
        ROUND_OVER: "bg-gray-700 text-gray-200",
        GAME_OVER:  "bg-red-800/60 text-red-100",
    };
    const labels: Record<GameState["phase"], string> = {
        BID_PHASE:  "Bidding",
        RESOLVING:  "Resolving",
        ROUND_OVER: "Round Over",
        GAME_OVER:  "Game Over",
    };
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[phase]}`}>
            {labels[phase]}
        </span>
    );
}

function BudgetPill({ value, color, symbol, label }: {
    value: number; color: string; symbol: string; label: string;
}) {
    return (
        <span
            className={`font-bold ${color} ${value === 0 ? "opacity-30" : ""}`}
            title={`${value} ${label} remaining`}
        >
            {symbol}:{value}
        </span>
    );
}

function BidControl({
    value, canInc, canDec, onInc, onDec, color, symbol, disabled,
}: {
    value: number; canInc: boolean; canDec: boolean;
    onInc: () => void; onDec: () => void;
    color: string; symbol: string;
    disabled?: boolean;
}) {
    if (disabled) return null;
    return (
        <div className={`flex items-center gap-0.5 ${color}`}>
            <button
                onClick={onDec}
                disabled={!canDec}
                className="w-4 h-4 flex items-center justify-center rounded bg-black/30 hover:bg-black/50 disabled:opacity-20 disabled:cursor-not-allowed text-xs font-bold leading-none select-none"
            >
                −
            </button>
            <span className="w-4 text-center text-xs font-bold">{value}</span>
            <button
                onClick={onInc}
                disabled={!canInc}
                className="w-4 h-4 flex items-center justify-center rounded bg-black/30 hover:bg-black/50 disabled:opacity-20 disabled:cursor-not-allowed text-xs font-bold leading-none select-none"
            >
                +
            </button>
            <span className="text-[10px] ml-0.5 opacity-50">{symbol}</span>
        </div>
    );
}

function TokenBadge({ count, color, label, symbol }: {
    count: number; color: string; label: string; symbol: string;
}) {
    return (
        <span className={`flex items-center gap-0.5 ${color}`} title={`${count} ${label}`}>
            <span className="font-bold">{symbol}</span>
            <span>{count}</span>
        </span>
    );
}

function CheckIcon() {
    return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
    );
}
