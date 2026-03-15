// components/HowToPlayDialog.tsx
//
// Dismissible "How to Play" modal that can be opened from any page.
// Covers the full rules of Revolution: tokens, bidding, special actions,
// board locations, and the victory condition.

interface Props {
    onClose: () => void;
}

export default function HowToPlayDialog({ onClose }: Props) {
    return (
        <div
            className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
                    <h2 className="text-lg font-bold text-white">How to Play Revolution</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white text-xl leading-none transition-colors"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm text-gray-300">

                    {/* Goal */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">🎯 Goal</h3>
                        <p>
                            Seize control of the city by accumulating the most{" "}
                            <span className="text-yellow-300 font-medium">Support</span> points.
                            Support comes from winning bid spaces each round, controlling city locations
                            at game end, and cashing in leftover tokens.
                        </p>
                    </section>

                    {/* Tokens */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">💰 Tokens</h3>
                        <p className="mb-3">
                            Every round each player starts with a fresh token budget. You{" "}
                            <span className="font-medium text-white">must spend all tokens</span> — hoarding is not allowed.
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <div className="text-yellow-400 font-bold text-lg">3 Gold</div>
                                <div className="text-xs text-gray-400 mt-1">Can be bid on any space</div>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <div className="text-purple-400 font-bold text-lg">1 Blackmail</div>
                                <div className="text-xs text-gray-400 mt-1">Banned on dark-shaded spaces</div>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3 text-center">
                                <div className="text-red-400 font-bold text-lg">1 Force</div>
                                <div className="text-xs text-gray-400 mt-1">Banned on red-shaded spaces</div>
                            </div>
                        </div>
                        <p className="mt-3 text-gray-400 text-xs">
                            Winning certain bid spaces rewards you with bonus tokens that carry into the <em>next</em> round.
                        </p>
                    </section>

                    {/* Bidding */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">⚔️ Bidding</h3>
                        <ol className="space-y-2 list-decimal list-inside text-gray-300">
                            <li>
                                Secretly allocate your tokens across bid spaces. You may use{" "}
                                <span className="text-white font-medium">at most 6 of the 12 spaces</span> per round —
                                choose carefully.
                            </li>
                            <li>
                                When everyone has submitted, all bids are revealed simultaneously.
                            </li>
                            <li>
                                The player with the <span className="text-white font-medium">highest total bid</span> wins
                                that space and claims its reward.
                            </li>
                            <li>
                                Ties are broken by:{" "}
                                <span className="text-red-400">Force</span> &gt;{" "}
                                <span className="text-purple-400">Blackmail</span> &gt;{" "}
                                <span className="text-yellow-400">Gold</span>.
                                A perfect tie (all amounts equal) means <em>nobody</em> wins.
                            </li>
                        </ol>
                    </section>

                    {/* Bid Spaces */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">📋 Bid Spaces</h3>
                        <div className="space-y-2">
                            <div className="bg-gray-800 rounded-lg p-3">
                                <div className="font-medium text-white mb-1">Support spaces</div>
                                <div className="text-gray-400 text-xs space-y-0.5">
                                    <div><span className="text-gray-200">Priest</span> — 6 support · places a block in the Cathedral</div>
                                    <div><span className="text-gray-200">Printer</span> — 10 support (no block)</div>
                                    <div><span className="text-gray-200">Aristocrat</span> — 5 support + 3 gold · Plantation block</div>
                                    <div><span className="text-gray-200">Innkeeper</span> — 3 support + 1 blackmail · Tavern block</div>
                                    <div><span className="text-gray-200">Merchant</span> — 3 support + 5 gold · Market block</div>
                                    <div><span className="text-gray-200">Mercenary</span> — 3 support + 1 force (no block)</div>
                                </div>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3">
                                <div className="font-medium text-white mb-1">Token + influence spaces</div>
                                <div className="text-gray-400 text-xs space-y-0.5">
                                    <div><span className="text-gray-200">General</span> — 1 support + 1 force · Fortress block</div>
                                    <div><span className="text-gray-200">Captain</span> — 1 support + 1 force · Harbor block</div>
                                    <div><span className="text-gray-200">Magistrate</span> — 1 support + 1 blackmail · Town Hall block</div>
                                    <div><span className="text-gray-200">Rogue</span> — 2 blackmail (no block, no force allowed)</div>
                                </div>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3">
                                <div className="font-medium text-white mb-1">✨ Special action spaces</div>
                                <div className="text-gray-400 text-xs space-y-0.5">
                                    <div>
                                        <span className="text-gray-200">Spy</span> — choose one opponent's influence block
                                        on the board and replace it with your own. (No blackmail allowed.)
                                    </div>
                                    <div>
                                        <span className="text-gray-200">Apothecary</span> — swap any two occupied influence
                                        blocks on the board. (No force allowed.)
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Board locations */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">🏙️ City Locations</h3>
                        <p className="mb-3 text-gray-400">
                            When a bid space is won, the winner places an influence block in the linked city location.
                            At game end, the player with the{" "}
                            <span className="text-white font-medium">most cubes</span> in each location earns its bonus —
                            ties (two or more players tied for most) award nobody.
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            {[
                                { name: "Fortress",   slots: 8, bonus: 50 },
                                { name: "Town Hall",  slots: 6, bonus: 45 },
                                { name: "Harbor",     slots: 6, bonus: 40 },
                                { name: "Cathedral",  slots: 7, bonus: 35 },
                                { name: "Plantation", slots: 6, bonus: 30 },
                                { name: "Market",     slots: 5, bonus: 25 },
                                { name: "Tavern",     slots: 4, bonus: 20 },
                            ].map(({ name, slots, bonus }) => (
                                <div key={name} className="bg-gray-800 rounded-md px-3 py-2 flex items-center justify-between">
                                    <span className="text-gray-200">{name}</span>
                                    <span className="text-gray-500">{slots} slots · <span className="text-yellow-400">{bonus} pts</span></span>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* End game */}
                    <section>
                        <h3 className="text-white font-semibold text-base mb-2">🏆 End of Game</h3>
                        <p className="mb-3">
                            The game ends after the round in which{" "}
                            <span className="text-white font-medium">all influence slots on the board are filled</span>.
                            Final scoring happens in this order:
                        </p>
                        <ol className="space-y-1.5 list-decimal list-inside text-gray-300">
                            <li>Location bonuses are awarded (most cubes per location)</li>
                            <li>
                                Each player's remaining tokens convert to support:
                                <div className="mt-1.5 ml-5 flex gap-4 text-xs">
                                    <span className="text-red-400 font-semibold">Force = 5 pts each</span>
                                    <span className="text-purple-400 font-semibold">Blackmail = 3 pts each</span>
                                    <span className="text-yellow-400 font-semibold">Gold = 1 pt each</span>
                                </div>
                                <p className="text-xs text-gray-400 ml-5 mt-1">
                                    This includes any tokens won from bids in the final round.
                                </p>
                            </li>
                        </ol>
                        <p className="mt-3 text-gray-400">
                            The player with the most total Support wins.
                        </p>
                    </section>

                </div>

                {/* Footer */}
                <div className="shrink-0 px-6 py-4 border-t border-gray-800 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-md transition-colors"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
