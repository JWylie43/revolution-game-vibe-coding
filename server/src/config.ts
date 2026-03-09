// config.ts
//
// A single place to read and validate all environment variables.
//
// WHY: If you just call process.env.JWT_SECRET everywhere in your code, you get:
//   - No validation — the app starts even if secrets are missing
//   - No TypeScript types — process.env always returns string | undefined
//   - No central list of what config your app needs
//
// By centralizing here, we:
//   - Crash immediately on startup if required vars are missing (fail fast)
//   - Export typed config values with no "| undefined" noise
//   - Give every new developer one place to see all required config

// dotenv reads your .env file and loads it into process.env.
// We call this once at app startup.
import "dotenv/config";

// A helper that reads an env var and throws a clear error if it's missing.
// This function runs at module load time — if a var is missing, the app
// crashes immediately with a useful message instead of failing mysteriously later.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Crash hard and fast with a clear message.
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Check your .env file. See .env.example for reference.`
    );
  }
  return value;
}

// Export a single config object. Import this anywhere you need config values.
// TypeScript knows every field here is a string (not string | undefined).
export const config = {
  // Server
  port: parseInt(process.env.PORT ?? "3001", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // CLIENT_URL can be a single URL or comma-separated list for cross-machine testing.
  // e.g. "http://localhost:5173,http://192.168.1.50:5173"
  clientUrls: (process.env.CLIENT_URL ?? "http://localhost:5173")
    .split(",")
    .map((u) => u.trim()),

  // Database — required, crash if missing
  databaseUrl: requireEnv("DATABASE_URL"),

  // Redis — required, crash if missing
  redisUrl: requireEnv("REDIS_URL"),

  // Auth — required, crash if missing
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  // Computed helpers
  isDev: process.env.NODE_ENV !== "production",
  isProd: process.env.NODE_ENV === "production",
};
