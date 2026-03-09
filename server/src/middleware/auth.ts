// middleware/auth.ts
//
// Express middleware that verifies a user's JWT token on protected routes.
//
// ── What is Middleware? ────────────────────────────────────────────────────────
// In Express, middleware is a function that runs BETWEEN receiving a request
// and sending a response. You can chain multiple middleware functions.
//
// Request flow:
//   Browser → [auth middleware] → [route handler] → Browser
//
// If the token is invalid, auth middleware sends a 401 error and STOPS
// the request — the route handler never runs. If valid, it calls next()
// to pass the request along.
//
// ── What is a JWT? ────────────────────────────────────────────────────────────
// JWT = JSON Web Token. It's a compact, self-contained token that proves
// a user's identity without hitting the database on every request.
//
// Structure: header.payload.signature
// Example:   eyJhbG...  .  eyJ1c2VySWQiOiJhYmMxMjMifQ  .  SflKxwRJSMeKKF2Q...
//
// The payload contains: { userId: "abc123", username: "alice", iat: 1234567890 }
// The signature proves the payload hasn't been tampered with.
//
// Flow:
//   1. User logs in → server creates JWT signed with JWT_SECRET → sends to browser
//   2. Browser stores JWT (localStorage or cookie)
//   3. Every request: browser sends JWT in Authorization header
//   4. Server verifies signature using JWT_SECRET → trusts the payload
//   5. No database query needed to know who the user is!

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

// The data we encode inside the JWT token.
// Keep this small — it's sent with every request.
export interface TokenPayload {
  userId: string;
  username: string;
}

// TypeScript doesn't know that Express's Request object has a "user" field.
// We extend the type here so we can set req.user in this middleware
// and read it in route handlers without TypeScript complaining.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;  // Attached by auth middleware when token is valid
    }
  }
}

// ── The Middleware Function ────────────────────────────────────────────────────
// Express middleware signature: (req, res, next) => void
//   req  = the incoming request
//   res  = the response we can send
//   next = call this to pass control to the next middleware/handler
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Tokens are sent in the "Authorization" header with format: "Bearer <token>"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required. No token provided." });
    return; // Stop here — do NOT call next()
  }

  // Extract the token after "Bearer "
  const token = authHeader.split(" ")[1];

  try {
    // jwt.verify does two things:
    //   1. Checks the signature (proves the token hasn't been tampered with)
    //   2. Checks if the token is expired
    // If either check fails, it throws an error.
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;

    // Attach the decoded payload to the request object.
    // Any route handler after this middleware can read req.user.userId etc.
    req.user = payload;

    // Call next() to pass the request to the route handler.
    next();
  } catch (error) {
    // jwt.verify throws JsonWebTokenError or TokenExpiredError
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired. Please log in again." });
    } else {
      res.status(401).json({ error: "Invalid token." });
    }
  }
}

// ── Token Creation Helper ─────────────────────────────────────────────────────
// Used in the auth routes (login, register) to create a new JWT.
export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}
