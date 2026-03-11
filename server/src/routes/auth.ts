// routes/auth.ts
//
// REST endpoints for user registration and login.
//
// POST /api/auth/register  — create a new account
// POST /api/auth/login     — log in and receive a JWT

import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../services/prisma.js";
import { createToken } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";

// Router is like a mini Express app — it handles a group of related routes.
// We export it and mount it in index.ts at a path prefix (/api/auth).
const router = Router();

// ── Validation Schemas (Zod) ───────────────────────────────────────────────────
// Zod validates request body data at runtime.
// Without this, anyone could send { email: 12345 } and cause crashes.
//
// z.object() defines the shape of valid data.
// z.string().email() means: must be a string AND a valid email format.
// .min(3) means: at least 3 characters.

const registerSchema = z.object({
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(20, "Username must be at most 20 characters")
        .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, underscores"),
    email: z.string().email("Must be a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
    identifier: z.string().min(1),
    password: z.string().min(1),
});

// ── POST /register ─────────────────────────────────────────────────────────────
router.post("/register", authLimiter, async (req, res) => {
    // 1. Validate request body
    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
        // .flatten() gives a clean error format: { fieldErrors: { email: ["..."] } }
        res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
        return;
    }

    const { username, email, password } = result.data;

    try {
        // 2. Check if email or username is already taken
        const existing = await prisma.user.findFirst({
            where: {
                // Prisma "OR" — find a user where email matches OR username matches
                OR: [{ email }, { username }],
            },
        });

        if (existing) {
            const field = existing.email === email ? "email" : "username";
            res.status(409).json({ error: `That ${field} is already taken` });
            return;
        }

        // 3. Hash the password
        // bcrypt.hash(password, saltRounds)
        // saltRounds = 12 means bcrypt runs the hashing function 2^12 = 4096 times.
        // Higher = more secure but slower. 12 is a good balance (takes ~300ms).
        // This slowness is intentional — it makes brute-force attacks impractical.
        const hashedPassword = await bcrypt.hash(password, 12);

        // 4. Create the user in the database
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
            },
            // "select" limits which fields are returned — we NEVER return the password hash
            select: {
                id: true,
                username: true,
                email: true,
                createdAt: true,
            },
        });

        // 5. Create a JWT token so they're immediately logged in after registering
        const token = createToken({ userId: user.id, username: user.username });

        // 201 = "Created" (as opposed to 200 "OK" — the resource didn't exist before)
        res.status(201).json({ token, user });
    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Server error during registration" });
    }
});

// ── POST /login ────────────────────────────────────────────────────────────────
router.post("/login", authLimiter, async (req, res) => {
    // 1. Validate request body
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
    }

    const { identifier, password } = result.data;

    try {
        // 2. Find the user by email or username
        const user = await prisma.user.findFirst({
            where: {
                OR: [{ email: identifier }, { username: identifier }],
            },
        });

        // IMPORTANT: Return the same error message whether the identifier or password is wrong.
        // Distinct messages let attackers enumerate valid accounts.
        if (!user) {
            res.status(401).json({ error: "Invalid credentials" });
            return;
        }

        // 3. Verify the password against the stored hash
        // bcrypt.compare hashes the provided password the same way and compares.
        // Even if someone gets your database, they can't reverse hashes to passwords.
        const passwordValid = await bcrypt.compare(password, user.password);
        if (!passwordValid) {
            res.status(401).json({ error: "Invalid email or password" });
            return;
        }

        // 4. Issue a new JWT
        const token = createToken({ userId: user.id, username: user.username });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatarUrl: user.avatarUrl,
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Server error during login" });
    }
});

export default router;
