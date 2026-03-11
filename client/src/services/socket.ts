// services/socket.ts
//
// Creates and exports the Socket.io client instance.
//
// ── Why a singleton? ─────────────────────────────────────────────────────────
// Just like on the server, we want ONE socket connection for the entire app.
// If you called io("http://localhost:3001") in multiple components, you'd
// open multiple connections — the server would see the same user twice.
//
// ── How the client connects ───────────────────────────────────────────────────
// 1. Call socket.connect() when the user is authenticated
// 2. Pass the JWT token so the server can identify them
// 3. The server's auth middleware verifies the token on connection
// 4. If valid, the socket is connected and events can flow

import { io, Socket } from "socket.io-client";
import type {
    ServerToClientEvents,
    ClientToServerEvents,
} from "../../../server/src/socket/types.js";

// We import the types from the server so client and server share the same
// event definitions. If you add an event on the server, TypeScript will
// tell you to handle it on the client too.

// Create the socket but DON'T connect yet.
// "autoConnect: false" means we manually call socket.connect() after login.
// This prevents the socket from trying to connect before we have a token.
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001",
    {
        autoConnect: false,

        // Reconnection settings — what happens if the connection drops mid-game
        reconnection: true,
        reconnectionAttempts: 10, // Try 10 times before giving up
        reconnectionDelay: 1000, // Wait 1 second before first retry
        reconnectionDelayMax: 5000, // Cap retry delay at 5 seconds
        randomizationFactor: 0.5, // Add jitter to prevent thundering herd
    }
);

// ── Connect with Auth Token ───────────────────────────────────────────────────
// Call this after the user logs in. Passes the JWT to the server handshake.
export function connectSocket(token: string): void {
    // Set the auth token in the handshake data.
    // The server reads this in its io.use() middleware.
    socket.auth = { token };
    // Only connect if not already connected or connecting.
    if (!socket.active) {
        socket.connect();
    }
}

// Disconnect cleanly when user logs out.
export function disconnectSocket(): void {
    socket.disconnect();
}

// ── Debug Listeners (development only) ───────────────────────────────────────
if (import.meta.env.DEV) {
    socket.on("connect", () => console.log("Socket connected:", socket.id));
    socket.on("disconnect", (reason) => console.log("Socket disconnected:", reason));
    socket.on("connect_error", (err) => console.error("Socket connect error:", err.message));
    socket.on("logger:log", ({ label, data, ts }) => {
        const time = new Date(ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
        console.log(`%c[SERVER ${time}] ${label}`, "color: #7c3aed; font-weight: bold;", data);
    });
}

export default socket;
