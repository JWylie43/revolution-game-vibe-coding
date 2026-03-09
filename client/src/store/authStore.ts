// store/authStore.ts
//
// Global authentication state using Zustand.
//
// ── What is Zustand? ──────────────────────────────────────────────────────────
// Zustand is a lightweight state management library.
// "State management" = storing data that multiple components need to share.
//
// Example: The navbar needs to show the username. The lobby needs to know
// if the user is logged in before showing the join button. The game page
// needs the userId to submit bids. These all need the same auth data.
//
// Without global state: you'd pass props down through every component.
// With Zustand: any component can read/update the state directly.
//
// ── Why not Redux? ────────────────────────────────────────────────────────────
// Redux is powerful but verbose — lots of boilerplate (actions, reducers, etc.)
// Zustand achieves the same thing with much less code.
// For a game this size, Zustand is the right choice.

import { create } from "zustand";
import socket, { connectSocket, disconnectSocket } from "../services/socket";
import api from "../services/api";

// Wait for the socket to connect (or fail). Resolves in both cases so
// login/register never reject just because of a socket issue.
function waitForSocket(token: string): Promise<void> {
  return new Promise<void>((resolve) => {
    connectSocket(token);
    if (socket.connected) { resolve(); return; }
    socket.once("connect", resolve);
    socket.once("connect_error", () => resolve());
  });
}

// The shape of our auth state
interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthState {
  // State
  user: User | null;      // null = not logged in
  token: string | null;
  isLoading: boolean;     // True while checking if user is already logged in

  // Actions (functions that change state)
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;  // Check localStorage on app startup
}

// create() returns a hook: useAuthStore()
// Any component that calls useAuthStore() subscribes to state changes.
// When state changes, those components re-render automatically.
export const useAuthStore = create<AuthState>((set) => ({
  // ── Initial State ──────────────────────────────────────────────────────────
  user: null,
  token: null,
  isLoading: true,

  // ── Actions ────────────────────────────────────────────────────────────────

  login: async (email, password) => {
      const response = await api.post<{ token: string; user: User }>("/auth/login", {
          email,
          password,
      });
      const { token, user } = response.data;
      // Persist to localStorage so the user stays logged in across page refreshes
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));

      // Wait for socket before resolving so the caller (LoginPage) only
      // navigates once the socket is ready.
      await waitForSocket(token);

      // Update global state — all subscribed components re-render
      set({ user, token });
    // Make API call to our backend

  },

  register: async (username, email, password) => {
    const response = await api.post<{ token: string; user: User }>("/auth/register", {
      username,
      email,
      password,
    });

    const { token, user } = response.data;

    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));

    await waitForSocket(token);
    set({ user, token });
  },

  logout: () => {
    // Clear everything
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    disconnectSocket();
    set({ user: null, token: null });
  },

  loadUser: async () => {
    // Called once on app startup to restore the session from localStorage.
    // Without this, the user would be logged out every time they refresh the page.
    const token = localStorage.getItem("token");
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      // Verify the token is still valid with the server
      // (it might be expired if the user hasn't visited in a while)
      const response = await api.get<User>("/user/me");

      await waitForSocket(token);
      set({ user: response.data, token, isLoading: false });
    } catch {
      // Token invalid/expired OR socket failed to connect — clear and re-login
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      set({ user: null, token: null, isLoading: false });
    }
  },
}));
