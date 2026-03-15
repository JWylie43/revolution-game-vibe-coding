// App.tsx
//
// The root React component. Sets up routing and protects game routes.
//
// ── React Router ─────────────────────────────────────────────────────────────
// React Router lets you map URL paths to components.
//   /          → LobbyPage (home — create or join a game)
//   /login     → LoginPage
//   /register  → RegisterPage
//   /:code     → GameRoomPage (lobby waiting room or active game)
//
// ── Protected Routes ──────────────────────────────────────────────────────────
// Some routes should only be accessible when logged in.
// If a logged-out user tries to visit /:code, we redirect them to /login.
// The ProtectedRoute component handles this.

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./store/authStore";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import GameRoomPage from "./pages/GameRoomPage";
import HistoryPage from "./pages/HistoryPage";

// ── Protected Route Component ─────────────────────────────────────────────────
// Wraps routes that require authentication.
// If user is not logged in, redirects to /login.
// "replace" replaces the history entry so clicking Back doesn't loop.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user } = useAuthStore();
    const location = useLocation();

    if (!user) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }

    return <>{children}</>;
}

// ── Guest Route Component ──────────────────────────────────────────────────────
// Wraps routes that should only be accessible when NOT logged in.
// If a logged-in user visits /login or /register, redirect them home.
function GuestRoute({ children }: { children: React.ReactNode }) {
    const { user } = useAuthStore();

    if (user) {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}

// ── App Component ─────────────────────────────────────────────────────────────
export default function App() {
    const { loadUser, isLoading } = useAuthStore();

    // On app startup, try to restore the user's session from localStorage.
    // useEffect with [] runs once, after the component first renders.
    useEffect(() => {
        loadUser();
    }, []);

    // Block all routes until we know whether the user is authenticated.
    // This prevents ProtectedRoute/GuestRoute from redirecting based on stale state.
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-xl text-gray-400">Loading...</div>
            </div>
        );
    }

    return (
        // BrowserRouter enables URL-based routing using the browser's History API.
        // This is what lets you navigate to /lobby without a full page reload.
        <BrowserRouter>
            <Toaster position="top-right" toastOptions={{ style: { background: "#1f2937", color: "#f9fafb" } }} />
            <Routes>
                {/* Guest routes — redirects to / if already authenticated */}
                <Route
                    path="/login"
                    element={
                        <GuestRoute>
                            <LoginPage />
                        </GuestRoute>
                    }
                />
                <Route
                    path="/register"
                    element={
                        <GuestRoute>
                            <RegisterPage />
                        </GuestRoute>
                    }
                />

                {/* Protected routes — redirects to /login if not authenticated */}
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <HomePage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/history"
                    element={
                        <ProtectedRoute>
                            <HistoryPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/:code"
                    element={
                        <ProtectedRoute>
                            <GameRoomPage />
                        </ProtectedRoute>
                    }
                />

                {/* 404 fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
