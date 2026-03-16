# Revolution Game

A multiplayer social deduction board game.

## Links

- **Play the game**: https://revolution-game-vibe-coding-client-two.vercel.app/
- **Vercel (frontend)**: https://vercel.com/jwylie43s-projects/revolution-game-vibe-coding-client
- **Railway (backend)**: https://railway.com/project/91a1b6ce-775d-4113-afbd-f96a69fb08ae

## Dev Setup

1. `docker compose up -d` — start Postgres + Redis
2. `npm install` — install all deps
3. `cd server && npx prisma db push` — sync DB schema
4. `npm run dev` — start client + server
