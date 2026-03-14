// pages/GameView.tsx

import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { GameState, BidSubmission } from "../../../server/src/socket/types.js";
import socket from "../services/socket.js";
import { useAuthStore } from "../store/authStore.js";
import CityBoard from "../components/CityBoard.js";
import type { BoardSlot } from "../components/CityBoard.js";
import BidBoardNew, { BID_SPACE_ORDER, type BidMap, type TokenType } from "../components/BidBoardNew.js";

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

function emptyBids(spaces: string[]): BidMap {
    return Object.fromEntries(spaces.map((id) => [id, { gold: 0, blackmail: 0, force: 0 }]));
}

export default function GameView({ gameState, userId }: Props) {
    const navigate = useNavigate();
    const { logout } = useAuthStore();
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

    // ── End-game derived data ──────────────────────────────────────────────────
    const playerScoreMap = useMemo(() => {
        const map: Record<string, number> = {};
        for (const p of gameState.players) map[p.userId] = p.score;
        return map;
    }, [gameState.players]);

    const playerUsernameMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const p of gameState.players) map[p.userId] = p.username;
        return map;
    }, [gameState.players]);

    // Compute per-location majority winner (null = tied / nobody)
    const locationWinners = useMemo<Record<string, string | null>>(() => {
        if (gameState.phase !== "GAME_OVER" || !gameState.boardLocations) return {};
        const result: Record<string, string | null> = {};
        for (const loc of gameState.boardLocations) {
            const counts: Record<string, number> = {};
            for (const slot of loc.slots) {
                if (slot.occupiedBy) counts[slot.occupiedBy] = (counts[slot.occupiedBy] ?? 0) + 1;
            }
            const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            if (entries.length === 0 || (entries.length > 1 && entries[0][1] === entries[1][1])) {
                result[loc.locationId] = null; // empty or tied
            } else {
                result[loc.locationId] = entries[0][0];
            }
        }
        return result;
    }, [gameState.phase, gameState.boardLocations]);

    // ── Bid state ──────────────────────────────────────────────────────────────
    const [bids, setBids] = useState<BidMap>(() => emptyBids(BID_SPACE_ORDER));
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [acking, setAcking] = useState(false);

    // ── Panel / board state ─────────────────────────────────────────────────
    const boardPanelRef   = usePanelRef();
    const sidebarPanelRef = usePanelRef();
    const boardScrollRef  = useRef<HTMLDivElement>(null);
    const [boardOpen,   setBoardOpen]   = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [boardZoom,   setBoardZoom]   = useState(1);

    // ── Special action selection state ────────────────────────────────────────
    // Stores the slots the user has clicked for spy (max 1) or apothecary (max 2)
    const [selectedSlots, setSelectedSlots] = useState<Array<{ locationId: string; slotIndex: number }>>([]);
    const [specialActionError, setSpecialActionError] = useState<string | null>(null);

    // Reset bids when a new round starts
    useEffect(() => {
        setBids(emptyBids(BID_SPACE_ORDER));
        setSubmitError(null);
    }, [gameState.roundNumber]);

    // Clear selection when phase changes away from SPECIAL_ACTIONS
    useEffect(() => {
        if (gameState.phase !== "SPECIAL_ACTIONS") {
            setSelectedSlots([]);
            setSpecialActionError(null);
        }
    }, [gameState.phase]);

    // Auto-open the board panel when it becomes the current user's turn for
    // a special action (so they can see the board to click slots)
    useEffect(() => {
        if (gameState.phase !== "SPECIAL_ACTIONS") return;
        const current = gameState.pendingSpecialActions?.[0];
        if (current?.userId !== userId) return;

        const panel = boardPanelRef.current as PanelImperativeHandle | null;
        if (panel?.isCollapsed()) {
            panel.expand();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState.phase, gameState.pendingSpecialActions, userId]);

    // Non-passive wheel listener — intercepts scroll wheel to zoom the board
    useEffect(() => {
        const el = boardScrollRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setBoardZoom((prev) => {
                const delta = e.deltaY > 0 ? -0.08 : 0.08;
                return Math.max(0.3, Math.min(4, prev + delta));
            });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

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

    function changeBid(spaceId: string, type: TokenType, delta: number) {
        if (delta > 0 && remaining[type] <= 0) return;
        setBids((prev) => {
            const cur = prev[spaceId] ?? { gold: 0, blackmail: 0, force: 0 };
            return { ...prev, [spaceId]: { ...cur, [type]: Math.max(0, cur[type] + delta) } };
        });
    }

    function handleSubmit() {
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
    const myAcked          = (gameState.resultsAckUserIds ?? []).includes(userId);

    function handleAck() {
        setAcking(true);
        socket.emit("game:resultsAck", (res) => {
            setAcking(false);
            if (!res.success) console.error("resultsAck failed:", res.error);
        });
    }

    // ── Special action slot click handler ─────────────────────────────────────
    // Only fires when it's the user's turn in SPECIAL_ACTIONS phase
    function handleSlotClick(locationId: string, slotIndex: number, slot: BoardSlot | null) {
        const current = gameState.pendingSpecialActions?.[0];
        if (!current || current.userId !== userId) return;
        if (gameState.phase !== "SPECIAL_ACTIONS") return;

        setSpecialActionError(null);

        const isAlreadySelected = selectedSlots.some(
            (s) => s.locationId === locationId && s.slotIndex === slotIndex
        );

        if (current.type === "spy") {
            // Must select an opponent's occupied slot
            if (!slot?.occupiedBy) {
                setSpecialActionError("That slot is empty — pick an opponent's cube");
                return;
            }
            if (slot.occupiedBy === userId) {
                setSpecialActionError("You can't replace your own cube");
                return;
            }
            setSelectedSlots(
                isAlreadySelected ? [] : [{ locationId, slotIndex }]
            );
        } else if (current.type === "apothecary") {
            // Must select two occupied slots (any owner)
            if (!slot?.occupiedBy) {
                setSpecialActionError("That slot is empty — pick an occupied cube");
                return;
            }
            if (isAlreadySelected) {
                setSelectedSlots((prev) =>
                    prev.filter((s) => !(s.locationId === locationId && s.slotIndex === slotIndex))
                );
            } else if (selectedSlots.length < 2) {
                setSelectedSlots((prev) => [...prev, { locationId, slotIndex }]);
            }
        }
    }

    function handleConfirmSpy() {
        if (selectedSlots.length !== 1) return;
        const { locationId, slotIndex } = selectedSlots[0];
        setSpecialActionError(null);
        socket.emit("game:spyAction", { locationId, slotIndex }, (res) => {
            if (res.success) {
                setSelectedSlots([]);
            } else {
                setSpecialActionError(res.error ?? "Action failed");
            }
        });
    }

    function handleConfirmApothecary() {
        if (selectedSlots.length !== 2) return;
        setSpecialActionError(null);
        socket.emit(
            "game:apothecaryAction",
            { slotA: selectedSlots[0], slotB: selectedSlots[1] },
            (res) => {
                if (res.success) {
                    setSelectedSlots([]);
                } else {
                    setSpecialActionError(res.error ?? "Action failed");
                }
            }
        );
    }

    function handleSkipSpecialAction() {
        const current = gameState.pendingSpecialActions?.[0];
        if (!current) return;
        setSelectedSlots([]);
        setSpecialActionError(null);
        if (current.type === "spy") {
            socket.emit("game:spyAction", { skip: true }, () => {});
        } else {
            socket.emit("game:apothecaryAction", { skip: true }, () => {});
        }
    }

    // Is it currently this user's turn to perform a special action?
    const isMySpecialTurn =
        gameState.phase === "SPECIAL_ACTIONS" &&
        (gameState.pendingSpecialActions?.[0]?.userId === userId);

    const currentSpecialAction = gameState.pendingSpecialActions?.[0] ?? null;

    // v4 imperative panel API: collapse() / expand()
    function toggleBoard(e: React.MouseEvent) {
        e.stopPropagation();
        const panel = boardPanelRef.current as PanelImperativeHandle | null;
        if (!panel) return;
        if (panel.isCollapsed()) {
            panel.expand();
        } else {
            panel.collapse();
        }
    }

    function toggleSidebar(e: React.MouseEvent) {
        e.stopPropagation();
        const panel = sidebarPanelRef.current as PanelImperativeHandle | null;
        if (!panel) return;
        if (panel.isCollapsed()) {
            panel.expand();
        } else {
            panel.collapse();
        }
    }

    return (
        <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">

            {/* ── Header ──────────────────────────────────────────────────────── */}
            <header className="flex items-center justify-between px-5 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-3">
                    <h1 className="font-bold text-base tracking-wide">Revolution!</h1>
                    <span className="text-sm text-gray-500">Round {gameState.roundNumber}</span>
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

                    {/* DEV shortcut — only visible in local dev builds */}
                    {import.meta.env.DEV && (
                        <button
                            onClick={() => socket.emit("dev:skipToEnd", (res) => {
                                if (!res.success) console.error("dev:skipToEnd:", res.error);
                            })}
                            className="px-2 py-1 text-[10px] bg-red-900/50 hover:bg-red-800/70 text-red-400 hover:text-red-200 rounded border border-red-800/60 transition-colors"
                            title="DEV: fill board and jump to end screen"
                        >
                            ⚡ End Game
                        </button>
                    )}

                    {/* Home */}
                    <button
                        onClick={() => { socket.emit("game:leave"); navigate("/"); }}
                        className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                        title="Leave game and go home (you can rejoin)"
                    >
                        ← Home
                    </button>

                    {/* Sign out */}
                    <button
                        onClick={() => { logout(); navigate("/"); }}
                        className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        Sign out
                    </button>
                </div>
            </header>

            {/* ── Three-panel body ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden">
                <Group orientation="horizontal" className="h-full">

                    {/* ── Left: City Board panel ───────────────────────────────── */}
                    <Panel
                        id="board"
                        panelRef={boardPanelRef}
                        collapsible
                        defaultSize="0%"
                        minSize="20%"
                        maxSize="55%"
                        onResize={(size) => setBoardOpen(size.asPercentage > 0)}
                        className="flex flex-col bg-gray-900"
                    >
                        {/* Board header */}
                        <div className="shrink-0 px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                City Board
                            </h2>
                            <button
                                onClick={() => setBoardZoom(1)}
                                className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors px-1 tabular-nums"
                                title="Reset zoom (scroll to zoom)"
                            >
                                {Math.round(boardZoom * 100)}%
                            </button>
                        </div>

                        {/* Scrollable + zoomable board */}
                        <div ref={boardScrollRef} className="flex-1 overflow-auto">
                            {gameState.boardLocations ? (
                                <div style={{ width: `${boardZoom * 100}%`, minWidth: "100%" }}>
                                    <CityBoard
                                        locations={gameState.boardLocations}
                                        playerColorMap={playerColorMap}
                                        onSlotClick={isMySpecialTurn ? handleSlotClick : undefined}
                                        selectedSlots={isMySpecialTurn ? selectedSlots : []}
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full">
                                    <p className="text-gray-600 text-sm">Board unavailable</p>
                                </div>
                            )}
                        </div>
                    </Panel>

                    {/* ── Separator: board ↔ main ──────────────────────────────── */}
                    <Separator className="relative w-1 bg-gray-800 hover:bg-indigo-500 transition-colors cursor-col-resize">
                        {/* Toggle button — on the main-content side (right of handle) */}
                        <button
                            onClick={toggleBoard}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="absolute top-1/2 -translate-y-1/2 -right-3 z-10 w-6 h-6 bg-gray-700 hover:bg-indigo-600 rounded-full flex items-center justify-center text-gray-300 hover:text-white transition-colors shadow-lg border border-gray-600 cursor-pointer"
                            title={boardOpen ? "Close board" : "Open board"}
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                {boardOpen
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                }
                            </svg>
                        </button>
                    </Separator>

                    {/* ── Middle: Main bid board ───────────────────────────────── */}
                    <Panel id="main" defaultSize="85%" minSize="40%" className="flex flex-col overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-4">

                            {/* ── Phase banners ─────────────────────────────────── */}
                            {gameState.phase === "RESOLVING" && (
                                <div className="mb-4 text-center text-yellow-400 font-semibold animate-pulse">
                                    Resolving bids…
                                </div>
                            )}

                            {/* ── Special actions panel ─────────────────────────── */}
                            {gameState.phase === "SPECIAL_ACTIONS" && currentSpecialAction && (
                                <div className={`mb-4 max-w-4xl mx-auto rounded-xl border p-4 ${
                                    isMySpecialTurn
                                        ? "bg-amber-950/40 border-amber-600/60"
                                        : "bg-gray-800/60 border-gray-700"
                                }`}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-lg">
                                            {currentSpecialAction.type === "spy" ? "🕵️" : "⚗️"}
                                        </span>
                                        <h3 className="font-semibold text-sm text-amber-300 uppercase tracking-wider">
                                            {currentSpecialAction.type === "spy" ? "Spy Action" : "Apothecary Action"}
                                        </h3>
                                        {gameState.pendingSpecialActions.length > 1 && (
                                            <span className="ml-auto text-xs text-gray-500">
                                                {gameState.pendingSpecialActions.length} actions remaining
                                            </span>
                                        )}
                                    </div>

                                    {isMySpecialTurn ? (
                                        /* Current user's turn */
                                        <div>
                                            <p className="text-sm text-gray-300 mb-3">
                                                {currentSpecialAction.type === "spy"
                                                    ? "Click an opponent's cube on the board to replace it with yours, then confirm. Or skip to do nothing."
                                                    : "Click two occupied cubes on the board to swap them, then confirm. Or skip to do nothing."}
                                            </p>

                                            {/* Selection status */}
                                            {currentSpecialAction.type === "spy" && (
                                                <p className="text-xs text-gray-400 mb-3">
                                                    {selectedSlots.length === 0
                                                        ? "No cube selected yet — click one on the board"
                                                        : "✓ Cube selected — hit Confirm or pick a different one"}
                                                </p>
                                            )}
                                            {currentSpecialAction.type === "apothecary" && (
                                                <p className="text-xs text-gray-400 mb-3">
                                                    {selectedSlots.length === 0
                                                        ? "No cubes selected — click two cubes on the board"
                                                        : selectedSlots.length === 1
                                                            ? "1 of 2 cubes selected — click the second cube"
                                                            : "✓ 2 cubes selected — hit Confirm or reselect"}
                                                </p>
                                            )}

                                            {specialActionError && (
                                                <p className="text-xs text-red-400 mb-3">{specialActionError}</p>
                                            )}

                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={
                                                        currentSpecialAction.type === "spy"
                                                            ? handleConfirmSpy
                                                            : handleConfirmApothecary
                                                    }
                                                    disabled={
                                                        currentSpecialAction.type === "spy"
                                                            ? selectedSlots.length !== 1
                                                            : selectedSlots.length !== 2
                                                    }
                                                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
                                                >
                                                    Confirm
                                                </button>
                                                <button
                                                    onClick={handleSkipSpecialAction}
                                                    className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 hover:text-white transition-colors"
                                                >
                                                    Skip
                                                </button>
                                                {!boardOpen && (
                                                    <button
                                                        onClick={() => {
                                                            const panel = boardPanelRef.current as PanelImperativeHandle | null;
                                                            panel?.expand();
                                                        }}
                                                        className="ml-auto px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
                                                    >
                                                        ← Open Board
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        /* Waiting for another player */
                                        <p className="text-sm text-gray-400 animate-pulse">
                                            Waiting for{" "}
                                            <span className="font-semibold text-white">
                                                {currentSpecialAction.username}
                                            </span>{" "}
                                            to {currentSpecialAction.type === "spy"
                                                ? "choose a cube to replace"
                                                : "choose two cubes to swap"}…
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* ── Bid board ─────────────────────────────────────── */}
                            <BidBoardNew
                                bids={bids}
                                remaining={remaining}
                                canBid={canBid}
                                phase={gameState.phase}
                                lastResults={gameState.lastRoundResults ?? undefined}
                                alreadySubmitted={alreadySubmitted}
                                playerOrder={sortedPlayers}
                                onChangeBid={changeBid}
                                className="max-w-4xl mx-auto"
                            />

                            {/* ── Submit / status row ──────────────────────────── */}
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

                                {/* Who has submitted — shown during bid phase */}
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

                                {/* ROUND_OVER: OK button */}
                                {gameState.phase === "ROUND_OVER" && !isSpectator && (
                                    <button
                                        onClick={handleAck}
                                        disabled={myAcked || acking}
                                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
                                    >
                                        {myAcked ? "Waiting for others…" : acking ? "…" : "OK, Next Round"}
                                    </button>
                                )}
                                {gameState.phase === "ROUND_OVER" && (
                                    <div className="flex items-center gap-3 text-xs ml-auto">
                                        {gameState.players.filter(p => p.isConnected).map((p) => {
                                            const acked = (gameState.resultsAckUserIds ?? []).includes(p.userId);
                                            const ci    = playerColorMap[p.userId] ?? 0;
                                            return (
                                                <span key={p.userId} className="flex items-center gap-1">
                                                    <span className={`inline-block w-2 h-2 rounded-full ${SEAT_COLORS[ci].bg}`} />
                                                    <span className={acked ? "text-emerald-400" : "text-gray-600"}>
                                                        {p.username}{acked ? " ✓" : "…"}
                                                    </span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </Panel>

                    {/* ── Separator: main ↔ sidebar ────────────────────────────── */}
                    <Separator className="relative w-1 bg-gray-800 hover:bg-indigo-500 transition-colors cursor-col-resize">
                        {/* Toggle button — on the main-content side (left of handle = left of sidebar) */}
                        <button
                            onClick={toggleSidebar}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="absolute top-1/2 -translate-y-1/2 -left-3 z-10 w-6 h-6 bg-gray-700 hover:bg-indigo-600 rounded-full flex items-center justify-center text-gray-300 hover:text-white transition-colors shadow-lg border border-gray-600 cursor-pointer"
                            title={sidebarOpen ? "Collapse players" : "Expand players"}
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                {sidebarOpen
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                }
                            </svg>
                        </button>
                    </Separator>

                    {/* ── Right: Player sidebar panel ──────────────────────────── */}
                    <Panel
                        id="sidebar"
                        panelRef={sidebarPanelRef}
                        collapsible
                        defaultSize="15%"
                        minSize="12%"
                        maxSize="30%"
                        onResize={(size) => setSidebarOpen(size.asPercentage > 0)}
                        className="bg-gray-900 overflow-y-auto"
                    >
                        <div className="flex flex-col gap-2 p-3">
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

                                        {/* Special action indicator */}
                                        {gameState.phase === "SPECIAL_ACTIONS" &&
                                            currentSpecialAction?.userId === player.userId && (
                                            <span className="text-[11px] text-amber-400 animate-pulse">
                                                {currentSpecialAction.type === "spy" ? "🕵️ spy action…" : "⚗️ apothecary action…"}
                                            </span>
                                        )}

                                        {!player.isConnected && (
                                            <span className="text-[11px] text-gray-600">disconnected</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Panel>

                </Group>
            </div>

            {/* ── GAME OVER fullscreen overlay ─────────────────────────────── */}
            {gameState.phase === "GAME_OVER" && gameState.boardLocations && (
                <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">

                    {/* Header */}
                    <div className="shrink-0 bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4 flex-wrap">
                        <span className="text-2xl">🏆</span>
                        <div>
                            <h2 className="text-xl font-bold text-yellow-400">Revolution is Over!</h2>
                            {gameState.winner && (
                                <p className="text-sm text-gray-400">
                                    Winner:{" "}
                                    <span className="font-semibold text-white">
                                        {gameState.players.find((p) => p.userId === gameState.winner)?.username ?? gameState.winner}
                                    </span>
                                </p>
                            )}
                        </div>

                        {/* Player score summary */}
                        <div className="flex items-center gap-4 ml-4 flex-wrap">
                            {sortedPlayers.map((p) => {
                                const ci = playerColorMap[p.userId] ?? 0;
                                const isWinner = p.userId === gameState.winner;
                                return (
                                    <div key={p.userId} className="flex items-center gap-1.5">
                                        <span className={`w-3 h-3 rounded-full inline-block ${SEAT_COLORS[ci].bg}`} />
                                        <span className={`text-sm ${isWinner ? "text-white font-semibold" : "text-gray-400"}`}>
                                            {p.username}
                                        </span>
                                        <span className={`text-sm font-bold ${isWinner ? "text-yellow-400" : "text-gray-500"}`}>
                                            {p.score}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => { navigate("/"); }}
                            className="ml-auto px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 hover:text-white transition-colors"
                        >
                            Leave
                        </button>
                    </div>

                    {/* Board — fills remaining height, centred, maintains aspect ratio */}
                    <div className="flex-1 min-h-0 flex items-center justify-center p-4">
                        <div style={{ height: "100%", aspectRatio: "780 / 720", maxWidth: "100%" }}>
                            <CityBoard
                                locations={gameState.boardLocations}
                                playerColorMap={playerColorMap}
                                playerScores={playerScoreMap}
                                locationWinners={locationWinners}
                                playerUsernames={playerUsernameMap}
                            />
                        </div>
                    </div>

                </div>
            )}

        </div>
    );
}

// ── Small components ───────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: GameState["phase"] }) {
    const styles: Record<GameState["phase"], string> = {
        BID_PHASE:       "bg-indigo-800/60 text-indigo-200",
        RESOLVING:       "bg-yellow-700/60 text-yellow-100",
        SPECIAL_ACTIONS: "bg-amber-700/60 text-amber-100",
        ROUND_OVER:      "bg-gray-700 text-gray-200",
        GAME_OVER:       "bg-red-800/60 text-red-100",
    };
    const labels: Record<GameState["phase"], string> = {
        BID_PHASE:       "Bidding",
        RESOLVING:       "Resolving",
        SPECIAL_ACTIONS: "Special Actions",
        ROUND_OVER:      "Round Over",
        GAME_OVER:       "Game Over",
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
