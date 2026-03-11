# Revolution Game — Setup Guide
Okay it seems I need to update you how the bidding works and what the game conscept is.

The bid board will ahve 12 palces. Each space will provide some benefits if you win it. You bid on it with gold, blackmail, or force tokens. You start each round with some amount of these...determined by last ronuds results (or at the start of the game you get 3 gold, 1 blackmial and 1 force). The object of the game is to get the most amount of support (the games point system) you do this by either directly earning support by winning some special spaces on the bid board or by being the majortity controller of some location on the board at the end of the game. You can gain control over a location o the board by placing influence blocks in that location. In order to be able to place your block on that location you must earn that locations influecne by bidding on the correct bid spot. Almost all bid spaces will provide influence to a specific location if won...the moment you win it you place the block in that location if that location has an emprt space to place it. The actions taken by the player are taken in order that they show on the bid board. Each locatin grants a certain amount of support to whomever wins it at the end of the game. Now, the bidding and the benefits...each space has its own unique set of benfits from a pool of benefits.

Those benefits are:
earning gold
earing blackmail
earning force
earning support
and some special actions like replacing someone else block with your own or swapping two blocks already on the board.

Does this explain better?

So now I want you to


## Prerequisites

- **Node.js** v20+ — [nodejs.org](https://nodejs.org)
- **pnpm** — `npm install -g pnpm` (faster, more efficient than npm)
- **Docker Desktop** — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
  - Must be running (whale icon in system tray) before starting databases

---

## First-Time Setup

Run these once when you first clone the repo.

```bash
# 1. Start Postgres + Redis in the background
docker compose up -d

# 1.1 Check currently running containers
docker compose ps

# 2. Create your local environment file
#    The defaults already match Docker Compose — no edits needed for local dev
cd server && cp .env.example .env

# 3. Install all dependencies (client + server in one shot via pnpm workspaces)
cd .. && pnpm install

# 4. Create database tables from the Prisma schema
cd server && pnpm db:migrate

# 5. Start both client and server
cd .. && pnpm dev
```

Then open **http://localhost:5173**

---

## Daily Development

After first-time setup, this is all you need each day:

```bash
docker compose up -d   # Start databases (if not already running)
pnpm dev               # Start client + server together
```

---

## Ports

| Service              | URL                        | What it is |
|----------------------|----------------------------|------------|
| Frontend (Vite)      | http://localhost:5173       | React app — open this in your browser |
| Backend (Express)    | http://localhost:3001       | REST API + Socket.io server — your browser talks to this, you don't open it directly |
| PostgreSQL (Docker)  | localhost:5433              | Database — port 5433 because 5432 is taken by a native Windows Postgres install |
| Redis (Docker)       | localhost:6379              | In-memory cache for game state |

---

## Database — Viewing & Querying

### Prisma Studio (easiest — visual browser)
```bash
cd server
pnpm db:studio
```
Opens at **http://localhost:5555** — browse tables, filter rows, edit values. No SQL needed.

### psql (raw SQL in the terminal)
```bash
docker exec -it revolution_postgres psql -U revolution_user -d revolution_db
```

Useful queries once inside:
```sql
\dt                                  -- list all tables
SELECT id, username, email FROM users;
SELECT id, code, status FROM games;
\q                                   -- exit
```

### TablePlus or DBeaver (recommended GUI client)
- **TablePlus** — https://tableplus.com (free tier is fine)
- **DBeaver** — https://dbeaver.io (fully free)

Connection settings:
| Field    | Value            |
|----------|------------------|
| Host     | localhost        |
| Port     | 5432             |
| Database | revolution_db    |
| Username | revolution_user  |
| Password | revolution_pass  |

### Redis — View live game state
```bash
docker exec -it revolution_redis redis-cli

KEYS *                        # list all keys
GET game:{gameId}:state       # full game state JSON blob
GET player:{userId}:gameId    # which game a player is in
KEYS game:*                   # all game-related keys
# See all rate limit keys
docker exec revolution_redis redis-cli KEYS "rl:*"

# Delete auth limiter for localhost
docker exec revolution_redis redis-cli DEL "rl:auth:::1"

# Delete auth limiter for LAN IP
docker exec revolution_redis redis-cli DEL "rl:auth:::ffff:192.168.86.70"

# Or nuke all rate limit keys at once
docker exec revolution_redis redis-cli --scan --pattern "rl:*" | xargs docker exec -i revolution_redis redis-cli DEL
```
Or use **RedisInsight** (free GUI) — connect to `localhost:6379`.

---

## Docker Reference

```bash
docker compose up -d      # Start containers (background)
docker compose stop       # Stop containers — data kept
docker compose down       # Stop + remove containers — data still kept in volume
docker compose down -v    # ⚠️  Wipe everything including database data
docker compose ps         # Check container status
docker compose logs -f    # Tail logs from all containers
```

Data is stored in Docker named volumes (`postgres_data`, `redis_data`).
It persists across restarts and `docker compose down`. Only `-v` destroys it.

---

## Prisma (Database Schema) Reference

```bash
# After changing prisma/schema.prisma — create + apply a migration
pnpm db:migrate

# Regenerate the TypeScript client without migrating (rarely needed)
pnpm db:generate

# Open visual table browser
pnpm db:studio

# Reset database completely (⚠️ deletes all data)
cd server && npx prisma migrate reset
```

All Prisma commands must be run from the `server/` directory.

---

## Project Structure

```
revolution-game/
├── docker-compose.yml           Postgres + Redis containers
├── package.json                 Root workspace — runs both apps
├── pnpm-workspace.yaml          Tells pnpm which folders are packages
├── SETUP.md                     This file
│
├── client/                      Vite + React frontend
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── main.tsx             Entry point
│       ├── App.tsx              Router + ProtectedRoute
│       ├── index.css            Tailwind base styles
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── RegisterPage.tsx
│       │   ├── LobbyPage.tsx    Create / join games
│       │   └── GamePage.tsx     Waiting room + game board
│       ├── store/
│       │   └── authStore.ts     Global auth state (Zustand)
│       └── services/
│           ├── api.ts           Axios HTTP client (auto-attaches JWT)
│           └── socket.ts        Socket.io singleton client
│
└── server/
    ├── prisma/
    │   ├── schema.prisma        Database table definitions
    │   └── migrations/          Auto-generated SQL migration files
    └── src/
        ├── index.ts             Express app + HTTP server entry point
        ├── config.ts            Environment variable validation
        ├── middleware/
        │   └── auth.ts          JWT verification middleware + createToken
        ├── routes/
        │   ├── auth.ts          POST /api/auth/register, /login  GET /api/auth/me
        │   └── lobby.ts         POST /api/lobby/create  GET /api/lobby/:code
        ├── services/
        │   ├── prisma.ts        Prisma client singleton
        │   └── redis.ts         Redis clients + key helpers + get/setGameState
        ├── socket/
        │   ├── index.ts         Socket.io init, auth middleware, connection handling
        │   ├── types.ts         Typed events (ServerToClient, ClientToServer)
        │   ├── lobbyHandler.ts  lobby:join, lobby:ready → triggers game start
        │   └── gameHandler.ts   game:submitBids, resolveRound
        └── game/
            ├── blocks.ts        All board spaces + token constants
            └── engine.ts        Pure game logic — no I/O, fully testable
```

---

## Tech Stack Decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React | No SSR needed for a game; Vite is fast in dev |
| Styling | Tailwind CSS | Utility classes, no separate CSS files |
| State | Zustand | Simple global state without Redux boilerplate |
| HTTP client | Axios | Auto JWT injection via interceptor |
| Backend | Express | Minimal wrapper over Node HTTP |
| Real-time | Socket.io | Rooms, reconnection, typed events |
| Database | PostgreSQL | ACID transactions for bid resolution; great for relational data + leaderboards |
| ORM | Prisma | Type-safe queries generated from schema; migration management |
| Cache | Redis | Sub-ms game state reads; session storage; Socket.io multi-server adapter |
| Auth | JWT + bcrypt | Stateless tokens; bcrypt for secure password hashing |
| Validation | Zod | Runtime schema validation on all API inputs |

---

## Troubleshooting

**"Can't connect to database"**
Docker isn't running or containers aren't up. Run `docker compose up -d` and check with `docker compose ps`.

**"Module not found" / import errors**
Run `pnpm install` from the project root (not inside client/ or server/).

**"Prisma client not generated"**
Run `cd server && pnpm db:generate`.

**"Port already in use"**
Something else is on 5173 or 3001. Change `PORT` in `server/.env` and `server.port` in `client/vite.config.ts`.

**Wipe and start fresh**
```bash
docker compose down -v   # destroy containers + all data
docker compose up -d
cd server && pnpm db:migrate
```
