// routes/user.ts
//
// Authenticated user endpoints — all routes here require a valid JWT.
// apiLimiter and requireAuth are applied at the router level so every
// route defined in this file gets them automatically.
//
// GET /api/user/me  — return the logged-in user's profile

import { Router } from "express";
import prisma from "../services/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

const router = Router();

router.use(apiLimiter, requireAuth);

// ── GET /me ────────────────────────────────────────────────────────────────────
router.get("/me", async (req, res) => {
    const userId = req.user!.userId;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                avatarUrl: true,
                createdAt: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        res.json(user);
    } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ error: "Server error" });
    }
});

export default router;
