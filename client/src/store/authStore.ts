// store/authStore.ts
//
// Global authentication state using Zustand.
// Only concerns itself with auth — socket connection is handled by GameRoomPage.

import { create } from "zustand";
import { disconnectSocket } from "../services/socket";
import api from "../services/api";

interface User {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
}

interface AuthState {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (identifier: string, password: string) => Promise<void>;
    register: (username: string, email: string, password: string) => Promise<void>;
    logout: () => void;
    loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: null,
    isLoading: true,

    login: async (identifier, password) => {
        const response = await api.post<{ token: string; user: User }>("/auth/login", {
            identifier,
            password,
        });
        const { token, user } = response.data;
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
        set({ user, token });
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
        set({ user, token });
    },

    logout: () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        disconnectSocket();
        set({ user: null, token: null });
    },

    loadUser: async () => {
        const token = localStorage.getItem("token");
        if (!token) {
            set({ isLoading: false });
            return;
        }
        try {
            const response = await api.get<User>("/user/me");
            set({ user: response.data, token, isLoading: false });
        } catch {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            set({ user: null, token: null, isLoading: false });
        }
    },
}));
