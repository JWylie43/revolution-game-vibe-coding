// components/BidBoardNew.tsx
//
// HTML/CSS bid board — ported from external BidBoard component.
// Data model matches the external component:
//   – bidBoardDef array with `acceptedTokens` (pre-filtered per space) & `benefits` array
//   – Colors: bg-yellow-700 = Gold Only · bg-red-700 = No Force ·
//             bg-black = No Blackmail · bg-amber-950 = Both Allowed
// Custom SVG token icons replace Heroicons.

import { useState } from "react";

// ── Public types ─────────────────────────────────────────────────────────────

export type TokenType = "gold" | "blackmail" | "force";
export type BidMap = Record<string, { gold: number; blackmail: number; force: number }>;
export interface BidResult {
    blockId: string;
    winnerUserId: string | null;
    winnerUsername: string | null;
    bids: Array<{
        userId: string;
        username: string;
        gold: number;
        blackmail: number;
        force: number;
    }>;
}

export const BID_SPACE_ORDER = [
    "general", "captain", "innkeeper", "magistrate",
    "priest", "aristocrat", "merchant", "printer",
    "rogue", "spy", "apothecary", "mercenary",
];

// ── Bid space definitions ────────────────────────────────────────────────────

type AcceptedTokens = Partial<Record<TokenType, number>>;

interface BidSpaceDef {
    id:             string;
    name:           string;
    noForce:        boolean;
    noBlackmail:    boolean;
    benefits:       string[];   // "Influence: X" lines rendered in indigo
    nextSpace:      string | null;
    acceptedTokens: AcceptedTokens;
}

const bidBoardDef: BidSpaceDef[] = [
    // ── Row 1 ──────────────────────────────────────────────────────────────
    {
        id: "general", name: "General", noForce: true, noBlackmail: false,
        benefits: ["1 Support", "1 Force", "Influence: Fortress"],
        nextSpace: "captain",
        acceptedTokens: { gold: 0, blackmail: 0 },
    },
    {
        id: "captain", name: "Captain", noForce: true, noBlackmail: false,
        benefits: ["1 Support", "1 Force", "Influence: Harbor"],
        nextSpace: "innkeeper",
        acceptedTokens: { gold: 0, blackmail: 0 },
    },
    {
        id: "innkeeper", name: "Innkeeper", noForce: false, noBlackmail: true,
        benefits: ["3 Support", "1 Blackmail", "Influence: Tavern"],
        nextSpace: "magistrate",
        acceptedTokens: { gold: 0, force: 0 },
    },
    {
        id: "magistrate", name: "Magistrate", noForce: false, noBlackmail: true,
        benefits: ["1 Support", "1 Blackmail", "Influence: Town Hall"],
        nextSpace: "priest",
        acceptedTokens: { gold: 0, force: 0 },
    },

    // ── Row 2 ──────────────────────────────────────────────────────────────
    {
        id: "priest", name: "Priest", noForce: false, noBlackmail: false,
        benefits: ["6 Support", "Influence: Cathedral"],
        nextSpace: "aristocrat",
        acceptedTokens: { gold: 0, blackmail: 0, force: 0 },
    },
    {
        id: "aristocrat", name: "Aristocrat", noForce: false, noBlackmail: false,
        benefits: ["5 Support", "3 Gold", "Influence: Plantation"],
        nextSpace: "merchant",
        acceptedTokens: { gold: 0, blackmail: 0, force: 0 },
    },
    {
        id: "merchant", name: "Merchant", noForce: false, noBlackmail: false,
        benefits: ["3 Support", "5 Gold", "Influence: Market"],
        nextSpace: "printer",
        acceptedTokens: { gold: 0, blackmail: 0, force: 0 },
    },
    {
        id: "printer", name: "Printer", noForce: false, noBlackmail: false,
        benefits: ["10 Support"],
        nextSpace: "rogue",
        acceptedTokens: { gold: 0, blackmail: 0, force: 0 },
    },

    // ── Row 3 ──────────────────────────────────────────────────────────────
    {
        id: "rogue", name: "Rogue", noForce: true, noBlackmail: true,
        benefits: ["2 Blackmail"],
        nextSpace: "spy",
        acceptedTokens: { gold: 0 },
    },
    {
        id: "spy", name: "Spy", noForce: false, noBlackmail: true,
        benefits: ["Replace an Influence Cube"],
        nextSpace: "apothecary",
        acceptedTokens: { gold: 0, force: 0 },
    },
    {
        id: "apothecary", name: "Apothecary", noForce: true, noBlackmail: false,
        benefits: ["Swap Two Influence Cubes"],
        nextSpace: "mercenary",
        acceptedTokens: { gold: 0, blackmail: 0 },
    },
    {
        id: "mercenary", name: "Mercenary", noForce: true, noBlackmail: true,
        benefits: ["3 Support", "1 Force"],
        nextSpace: null,
        acceptedTokens: { gold: 0 },
    },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
    bids?:             BidMap;
    remaining?:        { gold: number; blackmail: number; force: number };
    canBid?:           boolean;
    phase?:            string;
    lastResults?:      BidResult[];
    alreadySubmitted?: boolean;
    playerOrder?:      Array<{ userId: string }>;
    onChangeBid?:      (spaceId: string, type: TokenType, delta: number) => void;
    className?:        string;
}

// ── Token SVG icons ──────────────────────────────────────────────────────────

// Gold: coin with gold background fill + concentric ring detail
function GoldSvg({ s = 36 }: { s?: number }) {
    return (
        <svg width={s} height={s} viewBox="0 0 48 48">
            {/* Gold background */}
            <circle cx="24" cy="24" r="21.5" fill="#f59e0b"/>
            {/* Outer ring */}
            <circle cx="24" cy="24" r="21.5" fill="none"
                stroke="#92400e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            {/* Inner ring */}
            <circle cx="24" cy="24" r="14.5" fill="none"
                stroke="#92400e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            {/* Arc detail */}
            <path fill="none" stroke="#92400e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                d="m24,15.0654c4.9344,0,8.9346,4.0001,8.9346,8.9346"/>
        </svg>
    );
}

// Blackmail: envelope icon, black fill with white stroke lines
function BlackmailSvg({ s = 36 }: { s?: number }) {
    return (
        <svg width={s} height={s} viewBox="0 0 32 32">
            <path fill="#000000" stroke="#ffffff" strokeWidth="0.75" strokeLinejoin="round"
                d="M16.015 18.861l-4.072-3.343-8.862 10.463h25.876l-8.863-10.567-4.079 3.447z
                   M29.926 6.019h-27.815l13.908 11.698 13.907-11.698z
                   M20.705 14.887l9.291 11.084v-18.952l-9.291 7.868z
                   M2.004 7.019v18.952l9.291-11.084-9.291-7.868z"/>
        </svg>
    );
}

// Force: open-hand fist — red fill (outer silhouette), black stroke detail lines
function ForceSvg({ s = 36 }: { s?: number }) {
    // Outer silhouette only — used for the solid red fill layer
    const outerD = "M500.004,218.924c0-0.948,0-0.948,0-0.948c-7.094-23.056-17.506-38.644-29.684-48.323"
        + "c-1.606-14.585-4.008-29.997-7.294-47.44c-7.585-38.874-31.289-63.526-61.63-63.526h-8.533"
        + "c-13.274,0-32.237,5.689-46.459,30.341c-8.533-27.496-34.133-49.304-62.578-49.304h-0.948"
        + "c-28.444,0-54.044,21.807-62.578,50.252c-12.326-19.911-29.393-31.289-49.304-31.289H169.1"
        + "c-29.393,0-55.941,22.756-63.526,52.148c-10.43-16.119-23.704-23.704-39.822-23.704"
        + "c-18.015,0-42.667,9.482-56.889,57.837C-2.514,197.117-4.411,249.265,5.071,301.413l3.793,18.963"
        + "c8.533,28.444,26.548,41.719,56.889,41.719c18.015,0,33.185-6.637,44.563-18.015"
        + "c9.481,21.807,32.237,36.978,59.733,36.978h1.896c20.859,0,38.874-8.533,50.252-21.807"
        + "c3.751,9.378,9.736,17.711,17.353,24.365l-0.286,0.286c-1.896,0.948-2.844,1.896-2.844,3.793"
        + "c-3.793,12.326-3.793,28.444,0.948,40.77c9.482,24.652,32.237,40.77,58.785,40.77"
        + "c6.637,0,13.274-0.948,18.015-0.948c0,0,121.363-34.133,122.311-34.133"
        + "c44.563-13.274,55.941-49.304,63.526-73.007C513.278,314.687,513.278,267.28,500.004,218.924z";

    // All subpaths — used for the black stroke detail lines
    const fullD = outerD
        + "M236.419,336.495V318.48v-79.644c0-5.689-3.793-9.482-9.482-9.482s-9.481,3.793-9.481,9.482v79.644"
        + "c0,24.652-19.911,43.615-46.459,43.615H169.1c-26.548,0-46.459-18.963-46.459-43.615v-3.793v-6.637"
        + "v-69.215c0-5.689-3.793-9.482-9.482-9.482s-9.481,3.793-9.481,9.482v69.215"
        + "c0,19.911-16.119,35.081-37.926,35.081c-22.756,0-32.237-6.637-37.926-27.496l-3.793-18.015"
        + "c-8.533-49.304-7.585-99.556,3.793-147.911c8.533-28.444,20.859-43.615,37.926-43.615"
        + "c11.378,0,20.859,7.585,29.393,23.704c1.896,2.844,4.741,4.741,9.482,4.741h9.482"
        + "c4.741,0,9.481-4.741,9.481-9.481c0.948-25.6,22.756-47.407,46.459-47.407h1.896"
        + "c19.911,0,32.237,18.015,37.926,32.237c0.948,3.793,4.741,5.689,8.533,5.689h9.482"
        + "c4.741,0,9.481-4.741,9.481-9.482c0.948-25.6,22.756-47.407,46.459-47.407h0.948"
        + "c23.704,0,45.511,21.807,46.459,47.407c0,5.689,4.741,9.482,9.481,9.482h9.482"
        + "c3.793,0,7.585-2.844,9.482-6.637c7.585-20.859,18.963-31.289,34.133-31.289h8.533"
        + "c24.652,0,38.874,25.6,41.719,48.356c3.845,21.15,6.495,39.264,7.994,56.618"
        + "c2.322,32.86,1.192,62.609-4.202,110.256l-3.793,27.496c-3.793,15.17-14.222,41.719-43.615,41.719"
        + "h-8.533c-23.704,0-42.667-17.067-42.667-39.822v-92.919c0-5.689-3.793-9.481-9.482-9.481"
        + "c-5.689,0-9.481,3.793-9.481,9.481v92.919v14.222c0,25.6-19.911,44.563-46.459,44.563h-0.948"
        + "c-0.591,0-1.177-0.022-1.763-0.043c-7.246-0.325-14.443-2.609-21.013-5.689"
        + "C245.985,367.689,236.419,353.183,236.419,336.495z"
        + "M482.937,354.51c-8.533,26.548-18.963,50.252-50.252,59.733l-122.311,34.133"
        + "c-23.704,6.637-47.407-4.741-54.993-26.548c-2.844-7.585-2.844-18.015-0.948-26.548"
        + "l2.362-0.787c8.212,3.546,17.345,5.528,27.031,5.528h0.948h0h0.948"
        + "c26.957,0,50.258-15.497,60.097-38.441c10.459,12.999,27.355,20.426,47.044,20.426h8.533"
        + "c16.742,0,31.037-5.978,41.876-17.197c9.907-9.798,17.058-23.828,20.701-41.588l3.793-28.444"
        + "c4.741-35.081,6.637-63.526,5.689-94.815c2.844,6.637,6.637,14.222,9.482,22.756"
        + "C495.263,268.228,495.263,310.895,482.937,354.51z";

    return (
        <svg width={s} height={s} viewBox="0 0 510.96 510.96">
            <g transform="translate(1 1)">
                {/* Layer 1: solid red silhouette (outer contour only, no holes) */}
                <path fill="#dc2626" stroke="none" d={outerD}/>
                {/* Layer 2: black stroke detail lines (all subpaths) */}
                <path fill="none" stroke="#000000" strokeWidth="18" strokeLinejoin="round" d={fullD}/>
            </g>
        </svg>
    );
}

// ── Crown icon ───────────────────────────────────────────────────────────────

function CrownSvg({ s = 14 }: { s?: number }) {
    return (
        <svg width={s} height={s} viewBox="0 0 511.993 511.993" aria-hidden="true">
            <polygon fill="#FFD782" points="70.521,313.224 70.521,391.149 256,411.879 441.479,391.149 441.479,313.224 256,292.495"/>
            <circle fill="#FF6465" cx="139.621" cy="352.19" r="13.594"/>
            <circle fill="#FF6465" cx="255.996" cy="352.19" r="13.594"/>
            <circle fill="#FF6465" cx="372.384" cy="352.19" r="13.594"/>
            <path fill="#FFD782" d="M441.479,292.495l50.693-150.076l-10.654-11.414c0,0-131.556,159.811-215.767-15.981h-19.504c-84.209,175.792-215.767,15.981-215.767,15.981l-10.654,11.414l50.693,150.076H441.479z"/>
            <circle fill="#E6B95C" cx="255.996" cy="106.225" r="26.842"/>
            <circle fill="#E6B95C" cx="26.842" cy="137.382" r="26.842"/>
            <circle fill="#E6B95C" cx="485.151" cy="137.382" r="26.842"/>
            <ellipse fill="#FF6465" cx="255.996" cy="208.717" rx="22.568" ry="33.217"/>
            <path fill="#E6B95C" d="M441.479,271.766H70.521c-11.449,0-20.73,9.281-20.73,20.73c0,11.449,9.281,20.73,20.73,20.73h370.958c11.449,0,20.73-9.281,20.73-20.73C462.209,281.046,452.927,271.766,441.479,271.766z"/>
            <path fill="#E6B95C" d="M441.479,391.149H70.521c-11.449,0-20.73,9.281-20.73,20.73c0,11.449,9.281,20.73,20.73,20.73h370.958c11.449,0,20.73-9.281,20.73-20.73C462.209,400.431,452.927,391.149,441.479,391.149z"/>
        </svg>
    );
}

// ── Card color helpers (matching external component's Tailwind scheme) ────────

const DIAGONAL_BG = "linear-gradient(to bottom right, #b91c1c 50%, #000000 50%)";

function cardColors(noForce: boolean, noBlackmail: boolean): {
    className: string;
    style?: React.CSSProperties;
} {
    if (noForce && noBlackmail)
        return { className: "border border-red-800/70",  style: { background: DIAGONAL_BG } };
    if (noForce)
        return { className: "bg-red-800  border border-red-600/70"  };
    if (noBlackmail)
        return { className: "bg-black    border border-blue-500/30" };
    return     { className: "bg-amber-950 border border-amber-700/50" };
}

// ── Watermark symbols ────────────────────────────────────────────────────────

const MARK: Record<string, string> = {
    general:    "🛡",  captain:    "⚓",  innkeeper:  "🍺",  magistrate: "⚖",
    priest:     "✝",  aristocrat: "👑",  merchant:   "💰",  printer:    "📖",
    rogue:      "🗡",  spy:        "👁",  apothecary: "⚗",   mercenary:  "⚔",
};

// ── Individual bid-space card ────────────────────────────────────────────────

interface CardProps {
    space:            BidSpaceDef;
    bid:              { gold: number; blackmail: number; force: number };
    remaining:        { gold: number; blackmail: number; force: number };
    canBid:           boolean;
    atSpaceLimit:     boolean;  // true when 6 spaces already have tokens and this space has none
    alreadySubmitted: boolean;
    lastResult?:      BidResult;
    phase:            string;
    playerOrder?:     Array<{ userId: string }>;
    onChangeBid?:     Props["onChangeBid"];
}

function SpaceCard({
    space, bid, remaining, canBid, atSpaceLimit, alreadySubmitted, lastResult, phase, playerOrder, onChangeBid,
}: CardProps) {
    const [showBidPopup, setShowBidPopup] = useState(false);
    const showCounts   = canBid || alreadySubmitted;
    const visibleTypes = Object.keys(space.acceptedTokens) as TokenType[];
    const { className: bgClass, style: bgStyle } = cardColors(space.noForce, space.noBlackmail);
    // True if this space currently has no tokens allocated to it
    const thisBidTotal = bid.gold + bid.blackmail + bid.force;

    const spaceLocked = atSpaceLimit && thisBidTotal === 0;

    return (
        <div
            className={`relative flex flex-col rounded-lg overflow-hidden select-none ${bgClass} ${spaceLocked ? "opacity-40" : ""}`}
            style={{ minHeight: "9rem", ...bgStyle }}
            title={spaceLocked ? "6 spaces already in use — remove tokens from another space first" : undefined}
        >
            {/* Watermark */}
            <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ fontSize: 64, opacity: 0.055, lineHeight: 1 }}
                aria-hidden
            >
                {MARK[space.id]}
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col h-full p-2.5 gap-1">

                {/* Name */}
                <p className="text-white font-extrabold tracking-widest text-[10.5px] uppercase leading-none">
                    {space.name}
                </p>
                <div className="h-px bg-white/10"/>

                {/* Benefits — reward lines in gray-300, influence lines in indigo-400 */}
                <div className="flex flex-col gap-px">
                    {space.benefits.map((b, i) => {
                        const isInfluence = b.startsWith("Influence:");
                        return (
                            <p
                                key={i}
                                className={`text-[10px] leading-snug ${
                                    isInfluence ? "text-indigo-400" : "text-gray-300"
                                }`}
                            >
                                {isInfluence ? `→ ${b.slice(10).trim()}` : b}
                            </p>
                        );
                    })}
                </div>

                {/* Token slots — always rendered; counts only in bid/submitted mode */}
                <div className="mt-auto pt-1">
                    <div className="h-px bg-white/10 mb-2"/>
                    <div
                        className="flex items-end"
                        style={{
                            justifyContent:
                                visibleTypes.length === 1 ? "center"
                                : visibleTypes.length === 2 ? "space-evenly"
                                : "space-around",
                        }}
                    >
                        {visibleTypes.map(type => {
                            const count     = bid[type];
                            const exhausted = showCounts && !alreadySubmitted && remaining[type] <= 0 && count === 0;
                            // Blocked when: at the 6-space limit and this space has no tokens yet
                            const spaceLocked = atSpaceLimit && thisBidTotal === 0;
                            const clickable = canBid && !alreadySubmitted && !spaceLocked && (remaining[type] > 0 || count > 0);

                            return (
                                <div
                                    key={type}
                                    title={clickable ? "Left-click +1  ·  Right-click −1" : undefined}
                                    className={[
                                        "flex flex-col items-center gap-0.5 px-1 py-0.5 rounded transition-all duration-100",
                                        clickable ? "cursor-pointer hover:bg-white/10 hover:scale-110 active:scale-95" : "",
                                        exhausted ? "opacity-30" : "",
                                    ].join(" ")}
                                    onClick={() => clickable && onChangeBid?.(space.id, type, 1)}
                                    onContextMenu={e => {
                                        e.preventDefault();
                                        clickable && onChangeBid?.(space.id, type, -1);
                                    }}
                                >
                                    {type === "gold"      && <GoldSvg      s={28}/>}
                                    {type === "blackmail" && <BlackmailSvg s={28}/>}
                                    {type === "force"     && <ForceSvg     s={28}/>}

                                    {showCounts && (
                                        <span className={`text-[11px] font-bold font-mono leading-none tabular-nums ${
                                            count > 0 ? "text-white" : "text-white/20"
                                        }`}>
                                            {count}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* Results overlay — shown during ROUND_OVER / GAME_OVER when anyone bid */}
            {(phase === "ROUND_OVER" || phase === "GAME_OVER") && lastResult && lastResult.bids.length > 0 && (
                <>
                    <div
                        className="absolute inset-0 z-20 bg-black/75 flex items-end justify-center cursor-pointer p-1.5"
                        onClick={() => setShowBidPopup(true)}
                    >
                        <div className="w-full border border-white/30 rounded bg-black/60 px-2 py-1.5 flex flex-col gap-1">
                            {[...lastResult.bids].sort((a, b) => {
                                if (!playerOrder) return 0;
                                const ai = playerOrder.findIndex(p => p.userId === a.userId);
                                const bi = playerOrder.findIndex(p => p.userId === b.userId);
                                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                            }).map(b => {
                                const isWinner = b.userId === lastResult.winnerUserId;
                                return (
                                    <div key={b.userId} className="flex items-center gap-1 min-w-0">
                                        <div className="flex items-center gap-0.5 flex-1 min-w-0">
                                            <span className={`text-[10px] leading-tight truncate ${
                                                isWinner ? "font-bold text-white" : "font-normal text-gray-400"
                                            }`}>
                                                {b.username}
                                            </span>
                                            {isWinner && <CrownSvg s={12} />}
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            {b.gold > 0 && (
                                                <div className="relative inline-flex items-center justify-center">
                                                    <GoldSvg s={14} />
                                                    <span className="absolute -bottom-0.5 -right-0.5 text-[7px] font-bold text-white bg-black/80 rounded-full w-3 h-3 flex items-center justify-center leading-none">
                                                        {b.gold}
                                                    </span>
                                                </div>
                                            )}
                                            {b.blackmail > 0 && (
                                                <div className="relative inline-flex items-center justify-center">
                                                    <BlackmailSvg s={14} />
                                                    <span className="absolute -bottom-0.5 -right-0.5 text-[7px] font-bold text-white bg-black/80 rounded-full w-3 h-3 flex items-center justify-center leading-none">
                                                        {b.blackmail}
                                                    </span>
                                                </div>
                                            )}
                                            {b.force > 0 && (
                                                <div className="relative inline-flex items-center justify-center">
                                                    <ForceSvg s={14} />
                                                    <span className="absolute -bottom-0.5 -right-0.5 text-[7px] font-bold text-white bg-black/80 rounded-full w-3 h-3 flex items-center justify-center leading-none">
                                                        {b.force}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Bid detail popup — fixed so it escapes overflow:hidden */}
                    {showBidPopup && (
                        <BidDetailsPopup
                            space={space}
                            result={lastResult}
                            onClose={() => setShowBidPopup(false)}
                        />
                    )}
                </>
            )}

        </div>
    );
}

// ── Bid Details Popup ─────────────────────────────────────────────────────────
// Renders as a fixed overlay (escapes card's overflow:hidden).
// Shows each player's exact bids for this space, highlighting the winner.

function BidDetailsPopup({
    space,
    result,
    onClose,
}: {
    space: BidSpaceDef;
    result: BidResult;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-xl p-4 w-72 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-white">{space.name}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white text-base leading-none"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex flex-col gap-2">
                    {result.bids.map((b) => {
                        const isWinner = b.userId === result.winnerUserId;
                        return (
                            <div
                                key={b.userId}
                                className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                                    isWinner
                                        ? "bg-emerald-900/50 border border-emerald-700/40"
                                        : "bg-gray-800"
                                }`}
                            >
                                <span className={`text-xs font-semibold flex-1 truncate ${
                                    isWinner ? "text-emerald-300" : "text-white"
                                }`}>
                                    {b.username}{isWinner ? " ✓" : ""}
                                </span>
                                <div className="flex gap-2 text-xs shrink-0">
                                    {b.gold      > 0 && <span className="text-yellow-400">G:{b.gold}</span>}
                                    {b.blackmail > 0 && <span className="text-purple-400">B:{b.blackmail}</span>}
                                    {b.force     > 0 && <span className="text-red-400">F:{b.force}</span>}
                                    {b.gold === 0 && b.blackmail === 0 && b.force === 0 && (
                                        <span className="text-gray-600">0 bid</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
    const items: { label: string; className: string; style?: React.CSSProperties }[] = [
        { label: "No Force",     className: "bg-red-800  border border-red-600/70"   },
        { label: "No Blackmail", className: "bg-black    border border-blue-500/30"  },
        { label: "Gold Only",    className: "border border-red-800/70",
          style: { background: DIAGONAL_BG } },
    ];
    return (
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-0.5 pt-2 text-[11px] text-gray-500">
            {items.map(it => (
                <span key={it.label} className="flex items-center gap-1.5">
                    <span
                        className={`shrink-0 w-3.5 h-3.5 rounded-sm ${it.className}`}
                        style={it.style}
                    />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

// ── Board ────────────────────────────────────────────────────────────────────

export default function BidBoardNew({
    bids             = {},
    remaining        = { gold: 0, blackmail: 0, force: 0 },
    canBid           = false,
    phase            = "BID_PHASE",
    lastResults      = [],
    alreadySubmitted = false,
    playerOrder,
    onChangeBid,
    className        = "",
}: Props) {
    // Count how many spaces currently have at least one token on them
    const spacesUsed = Object.values(bids).filter(b => b.gold + b.blackmail + b.force > 0).length;
    const atSpaceLimit = spacesUsed >= 6;

    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {/* 6-space counter — only shown while actively bidding */}
            {canBid && !alreadySubmitted && (
                <div className={`flex items-center gap-2 text-xs px-0.5 ${atSpaceLimit ? "text-amber-400" : "text-gray-500"}`}>
                    <span>
                        Spaces used: <span className={`font-bold ${atSpaceLimit ? "text-amber-300" : "text-gray-300"}`}>{spacesUsed}</span> / 6
                    </span>
                    {atSpaceLimit && (
                        <span className="text-amber-500">— remove tokens to open a different space</span>
                    )}
                </div>
            )}
            <div className="grid grid-cols-4 gap-2">
                {bidBoardDef.map(space => (
                    <SpaceCard
                        key={space.id}
                        space={space}
                        bid={bids[space.id] ?? { gold: 0, blackmail: 0, force: 0 }}
                        remaining={remaining}
                        canBid={canBid}
                        atSpaceLimit={atSpaceLimit}
                        alreadySubmitted={alreadySubmitted}
                        lastResult={lastResults.find(r => r.blockId === space.id)}
                        phase={phase}
                        playerOrder={playerOrder}
                        onChangeBid={onChangeBid}
                    />
                ))}
            </div>
            <Legend/>
        </div>
    );
}
