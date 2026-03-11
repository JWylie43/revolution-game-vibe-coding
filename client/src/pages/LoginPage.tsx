// pages/LoginPage.tsx
//
// The login form.
//
// ── React Hooks Used ──────────────────────────────────────────────────────────
// useState  — stores local component state (form fields, error message, loading)
// useNavigate — programmatic navigation after successful login

import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function LoginPage() {
    // Local state for the form fields
    // useState(initialValue) returns [currentValue, setterFunction]
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Get the login action from our global auth store
    const { login } = useAuthStore();
    const navigate = useNavigate();
    const location = useLocation();
    const from = (location.state as { from?: string })?.from ?? "/";

    const handleSubmit = async (e: React.FormEvent) => {
        console.log("handeSubmit", from);
        // Prevent the browser's default form submission (which would reload the page)
        e.preventDefault();

        setIsLoading(true);
        setError(null);

        try {
            // throw new Error('test')
            await login(identifier, password);
            navigate(from, { replace: true });
        } catch (err: unknown) {
            // axios errors have a response property with the server's error message
            const message =
                (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
                "Login failed. Please try again.";
            setError(message);
        } finally {
            // Always reset loading, whether success or failure
            setIsLoading(false);
        }
    };

    return (
        // Full-screen centered layout using Tailwind flexbox classes
        <div className="min-h-screen flex items-center justify-center bg-gray-900">
            <div className="w-full max-w-md">
                {/* Card */}
                <div className="bg-gray-800 rounded-lg shadow-xl p-8">
                    <h1 className="text-3xl font-bold text-center text-white mb-2">Revolution</h1>
                    <p className="text-gray-400 text-center mb-8">Sign in to play</p>

                    {/* Error message — only shown when error is non-null */}
                    {error && (
                        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label
                                htmlFor="identifier"
                                className="block text-sm font-medium text-gray-300 mb-1"
                            >
                                Email or Username
                            </label>
                            <input
                                id="identifier"
                                type="text"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                required
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="you@example.com or username"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-300 mb-1"
                            >
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
                        >
                            {isLoading ? "Signing in..." : "Sign In"}
                        </button>
                    </form>

                    <p className="mt-4 text-center text-gray-400">
                        Don't have an account?{" "}
                        <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
                            Register
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
