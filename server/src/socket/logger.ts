// socket/logger.ts
//
// Dev-only helper for emitting structured log messages to the client browser.
// No-ops in production so you can leave calls in place without risk.
//
// Usage:
//   serverLog(socket, "gameState", gameState);           // → one player
//   serverLog(io.to(`game:${code}`), "roundResult", r);  // → whole room
//   serverLog(socket.to(`game:${code}`), "bid", bids);   // → room except sender

type Emitter = { emit: (event: "logger:log", data: { label: string; data: unknown; ts: number }) => unknown };

export function serverLog(target: Emitter, label: string, data?: unknown): void {
    if (process.env.NODE_ENV === "production") return;
    target.emit("logger:log", { label, data: data ?? null, ts: Date.now() });
}
