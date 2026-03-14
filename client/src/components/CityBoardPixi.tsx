// components/CityBoardPixi.tsx
//
// PixiJS v8 city board for Revolution.
// Shares the same props interface as CityBoard.tsx so it can be swapped in directly.
//
// Rendering approach:
//   - Static background (score track, plaza, 7 locations) is drawn once on init
//     into a `bgContainer` and never touched again.
//   - Dynamic slots layer is a separate `slotsContainer` that is cleared and
//     fully redrawn whenever `locations`, `playerColorMap`, or `selectedSlots` changes.
//   - Interactive slots use PixiJS pointer events instead of manual hit-testing.
//
// PixiJS v8 API notes:
//   - `new Application()` + `await app.init({...})` (async init)
//   - `g.rect(x,y,w,h).fill(color)` — draw and fill, resets path
//   - `g.roundRect(x,y,w,h,r).stroke({width,color})` — draw and stroke
//   - `g.moveTo().lineTo().stroke({...})` — lines
//   - `g.poly([x,y,...]).fill(color)` — filled polygon (flat coord array)
//   - `g.arc(cx,cy,r,start,end,ccw).fill(color)` — arc/pie slice
//   - `g.ellipse(cx,cy,hw,hh).fill(color)` — ellipse centred at cx,cy
//   - `new Text({ text, style: {...} })` — text node

import { useRef, useEffect } from "react";
import {
    Application,
    Container,
    Graphics,
    Text,
    TextStyle,
    Rectangle,
} from "pixi.js";

// ── Shared types (re-exported so GameView can import from here) ────────────────

export interface BoardSlot {
    slotIndex: number;
    occupiedBy: string | null;
    occupiedByUsername: string | null;
}

export interface BoardLocationData {
    locationId: string;
    locationName: string;
    endGameSupport: number;
    slots: BoardSlot[];
}

interface Props {
    locations?: BoardLocationData[];
    playerColorMap?: Record<string, number>;
    className?: string;
    onSlotClick?: (locationId: string, slotIndex: number, slot: BoardSlot | null) => void;
    selectedSlots?: Array<{ locationId: string; slotIndex: number }>;
}

// ── Canvas dimensions ──────────────────────────────────────────────────────────
const CW = 780;
const CH = 720;
const TW = 38; // score-track band width

// ── Player colours as PixiJS hex numbers (must match SEAT_COLORS in GameView) ──
const SEAT_COLORS_NUM = [0x3b82f6, 0x10b981, 0xf97316, 0xec4899, 0x06b6d4, 0xf43f5e];

// ── Location rects (same layout as CityBoard.tsx) ─────────────────────────────
const L = {
    plantation: { x: 40,  y: 40,  w: 205, h: 250 },
    tavern:     { x: 265, y: 40,  w: 168, h: 203 },
    cathedral:  { x: 453, y: 40,  w: 289, h: 185 },
    town_hall:  { x: 40,  y: 298, w: 205, h: 200 },
    fortress:   { x: 453, y: 298, w: 289, h: 200 },
    market:     { x: 40,  y: 506, w: 205, h: 170 },
    harbor:     { x: 265, y: 506, w: 477, h: 170 },
} as const;

// ── Influence slot centres (same as CityBoard.tsx) ────────────────────────────
const SLOTS: Record<string, [number, number][]> = {
    plantation: [[84,145],[143,145],[202,145], [84,218],[143,218],[202,218]],
    tavern:     [[307,140],[394,140], [307,210],[394,210]],
    cathedral:  [[504,108],[566,108],[628,108],[690,108], [535,160],[597,160],[659,160]],
    town_hall:  [[90,348],[195,348], [90,398],[195,398], [90,448],[195,448]],
    fortress:   [[517,390],[571,390],[625,390],[679,390], [517,431],[571,431],[625,431],[679,431]],
    market:     [[74,588],[133,588],[192,588], [103,642],[163,642]],
    harbor:     [[325,560],[465,560],[605,560], [325,620],[465,620],[605,620]],
};

// ── End-game support values ───────────────────────────────────────────────────
const SUPPORT: Record<string, number> = {
    plantation: 30, tavern: 20, cathedral: 35,
    town_hall: 45, fortress: 50, market: 25, harbor: 40,
};

// ── Colour helpers ─────────────────────────────────────────────────────────────

function shadeColorNum(hex: number, amount: number): number {
    const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + amount));
    const g = Math.min(255, Math.max(0, ((hex >> 8)  & 0xff) + amount));
    const b = Math.min(255, Math.max(0, ( hex         & 0xff) + amount));
    return (r << 16) | (g << 8) | b;
}

function makeStyle(overrides: Partial<ConstructorParameters<typeof TextStyle>[0]> = {}): TextStyle {
    return new TextStyle({ fontFamily: "system-ui, sans-serif", fontSize: 12, fill: "white", ...overrides });
}

// ── Nameplate banner ───────────────────────────────────────────────────────────

function nameplate(
    container: Container,
    cx: number, cy: number,
    label: string, support: number,
    textColor: number, bgColor: number,
) {
    const pw = label.length * 8.2 + 52;
    const ph = 28;

    const g = new Graphics();
    g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 3).fill(bgColor);

    const dark = shadeColorNum(bgColor, -30);
    g.poly([cx - pw / 2, cy - ph / 2 + 4,  cx - pw / 2 - 7, cy,  cx - pw / 2, cy + ph / 2 - 4]).fill(dark);
    g.poly([cx + pw / 2, cy - ph / 2 + 4,  cx + pw / 2 + 7, cy,  cx + pw / 2, cy + ph / 2 - 4]).fill(dark);

    const light = shadeColorNum(bgColor, 30);
    g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 3).stroke({ width: 1, color: light });

    container.addChild(g);

    const nameT = new Text({
        text: label,
        style: makeStyle({ fontFamily: "'Georgia', serif", fontSize: 14, fontWeight: "bold", fill: textColor }),
    });
    nameT.anchor.set(0.5);
    nameT.position.set(cx - 12, cy);
    container.addChild(nameT);

    const supT = new Text({
        text: String(support),
        style: makeStyle({ fontSize: 12, fontWeight: "bold", fill: 0xfbbf24 }),
    });
    supT.anchor.set(0.5);
    supT.position.set(cx + pw / 2 - 18, cy);
    container.addChild(supT);
}

// ── Tree ───────────────────────────────────────────────────────────────────────

function drawTree(c: Container, tx: number, ty: number, scale = 1) {
    const g = new Graphics();
    g.rect(tx - 3 * scale, ty + 10 * scale, 6 * scale, 16 * scale).fill(0x6b3a15);
    g.circle(tx, ty +  4 * scale, 14 * scale).fill(0x185c0a);
    g.circle(tx, ty -  4 * scale, 10 * scale).fill(0x22700d);
    g.circle(tx, ty - 11 * scale,  7 * scale).fill(0x2a8c10);
    c.addChild(g);
}

// ── Ship ───────────────────────────────────────────────────────────────────────

function drawShip(c: Container, sx: number, sy: number, sw: number) {
    const sh = sw * 0.45;
    const g = new Graphics();

    // Hull
    g.poly([
        sx + sw * 0.10, sy,
        sx + sw * 0.90, sy,
        sx + sw * 0.85, sy + sh,
        sx + sw * 0.15, sy + sh,
    ]).fill(0x3d2810);
    g.poly([
        sx + sw * 0.10, sy,
        sx + sw * 0.90, sy,
        sx + sw * 0.85, sy + sh,
        sx + sw * 0.15, sy + sh,
    ]).stroke({ width: 1.5, color: 0x5c3a18 });

    // Mast + yard arm
    g.moveTo(sx + sw * 0.5, sy - sh * 1.4).lineTo(sx + sw * 0.5, sy + sh * 0.3).stroke({ width: 2, color: 0x6b4820 });
    g.moveTo(sx + sw * 0.25, sy - sh * 0.9).lineTo(sx + sw * 0.75, sy - sh * 0.9).stroke({ width: 1.5, color: 0x6b4820 });

    // Main sail
    g.poly([
        sx + sw * 0.50, sy - sh * 1.35,
        sx + sw * 0.76, sy - sh * 0.85,
        sx + sw * 0.76, sy - sh * 0.15,
        sx + sw * 0.50, sy - sh * 0.10,
    ]).fill(0xc8b07a);

    // Foresail
    g.poly([
        sx + sw * 0.50, sy - sh * 1.35,
        sx + sw * 0.26, sy - sh * 0.85,
        sx + sw * 0.50, sy - sh * 0.15,
    ]).fill(0xb09068);

    // Flag
    g.poly([
        sx + sw * 0.50, sy - sh * 1.40,
        sx + sw * 0.65, sy - sh * 1.30,
        sx + sw * 0.50, sy - sh * 1.20,
    ]).fill(0xcc2020);

    c.addChild(g);
}

// ── Location drawers ───────────────────────────────────────────────────────────

function drawPlantation(c: Container) {
    const { x, y, w, h } = L.plantation;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x162e08);

    // Ground patches
    for (let i = 0; i < 6; i++) {
        g.ellipse(x + 30 + i * 32, y + h * 0.65, 18, 10).fill({ color: 0x327813, alpha: 0.08 });
    }

    // Driveway
    g.moveTo(x + w / 2, y + h - 5).lineTo(x + w / 2, y + h * 0.52).stroke({ width: 10, color: 0x2a4a12 });

    // Manor body
    const mx = x + w / 2 - 38, my = y + 90;
    g.rect(mx, my + 18, 76, 52).fill(0xc8b898);
    g.rect(mx - 18, my + 28, 18, 42).fill(0x8b6a40);
    g.rect(mx + 76, my + 28, 18, 42).fill(0x8b6a40);

    // Roofs
    g.poly([mx - 8,   my + 18, mx + 38, my - 8,  mx + 84,  my + 18]).fill(0x5c3a20);
    g.poly([mx - 26,  my + 28, mx - 10, my + 18, mx - 10,  my + 70]).fill(0x4a2e14);
    g.poly([mx + 102, my + 28, mx + 86, my + 18, mx + 86,  my + 70]).fill(0x4a2e14);

    // Door + windows
    g.rect(mx + 30, my + 48, 16, 22).fill(0x3a2010);
    g.rect(mx + 8,  my + 28, 14, 12).fill(0xf5e060);
    g.rect(mx + 54, my + 28, 14, 12).fill(0xf5e060);

    c.addChild(g);

    // Trees
    for (const [tx, ty, s] of [
        [x + 32, y + 70, 1], [x + w - 38, y + 68, 1],
        [x + 22, y + 195, 1], [x + w - 30, y + 188, 1],
        [x + 55, y + 52, 1], [x + w - 58, y + 50, 0.85],
    ] as [number, number, number][]) {
        drawTree(c, tx, ty, s);
    }

    nameplate(c, x + w / 2, y + 24, "PLANTATION", SUPPORT.plantation, 0x86efac, 0x1e4a0d);
}

function drawTavern(c: Container) {
    const { x, y, w, h } = L.tavern;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x3d1c0a);
    g.ellipse(x + w / 2, y + h * 0.8, 60, 20).fill({ color: 0x78501e, alpha: 0.12 });

    const bx = x + 22, by = y + 68, bw = w - 44, bh = 95;
    g.rect(bx, by, bw, bh).fill(0x6b3a1a);

    // Timbering
    g.moveTo(bx,          by + 30).lineTo(bx + bw,          by + 30).stroke({ width: 2, color: 0x3a1e08 });
    g.moveTo(bx + bw / 3, by     ).lineTo(bx + bw / 3,      by + bh).stroke({ width: 2, color: 0x3a1e08 });
    g.moveTo(bx + bw*2/3, by     ).lineTo(bx + bw*2/3,      by + bh).stroke({ width: 2, color: 0x3a1e08 });

    // Thatched roof
    g.poly([x + 10, by,  x + w / 2, y + 35,  x + w - 10, by]).fill(0x7a5820);
    // Roof lines
    for (let i = 0; i < 5; i++) {
        g.moveTo(x + 10 + i * 12, by).lineTo(x + w / 2, y + 35).stroke({ width: 1, color: 0x5c4010 });
    }

    // Door (rect + arch)
    g.rect(bx + bw / 2 - 10, by + bh - 30, 20, 30).fill(0x2a1008);
    g.arc(bx + bw / 2, by + bh - 30, 10, Math.PI, 0, false).fill(0x2a1008);

    // Windows with glow (simulate with bright yellow)
    g.rect(bx + 8,       by + 8, 16, 14).fill(0xf5e080);
    g.rect(bx + bw - 24, by + 8, 16, 14).fill(0xf5e080);

    // Sign backing
    g.rect(x + w / 2 - 28, by - 16, 56, 14).fill(0x4a2a08);
    g.rect(x + w / 2 - 28, by - 16, 56, 14).stroke({ width: 1, color: 0x8b5c20 });

    // Barrel
    g.ellipse(x + 15, y + h - 20, 10, 13).fill(0x5c3010);
    g.moveTo(x + 6, y + h - 22).lineTo(x + 24, y + h - 22).stroke({ width: 1.5, color: 0x3a1e08 });
    g.moveTo(x + 6, y + h - 16).lineTo(x + 24, y + h - 16).stroke({ width: 1.5, color: 0x3a1e08 });

    c.addChild(g);

    const signT = new Text({ text: "THE INN", style: makeStyle({ fontFamily: "'Georgia', serif", fontSize: 8, fontWeight: "bold", fill: 0xd4a050 }) });
    signT.anchor.set(0.5);
    signT.position.set(x + w / 2, by - 9);
    c.addChild(signT);

    nameplate(c, x + w / 2, y + 22, "TAVERN", SUPPORT.tavern, 0xfcd34d, 0x5c2c0c);
}

function drawCathedral(c: Container) {
    const { x, y, w, h } = L.cathedral;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x12203a);

    // Faint checkerboard
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 10; col++) {
            if ((row + col) % 2 === 0) {
                g.rect(x + col * 29, y + 30 + row * 28, 28, 27).fill({ color: 0x3c5078, alpha: 0.08 });
            }
        }
    }

    // Cross nave + transept
    const cx2 = x + w / 2, cy2 = y + h / 2;
    const naveH = 68;
    const naveLeft = x + 14, naveRight = x + w - 14;
    const transW = 52, transTop = y + 38, transBot = y + h - 12;

    g.rect(naveLeft, cy2 - naveH / 2, naveRight - naveLeft, naveH).fill(0x1e3460);
    g.rect(cx2 - transW / 2, transTop, transW, transBot - transTop).fill(0x1e3460);

    // Crossing columns
    for (const [cpx, cpy] of [
        [cx2 - transW / 2, cy2 - naveH / 2],
        [cx2 + transW / 2, cy2 - naveH / 2],
        [cx2 - transW / 2, cy2 + naveH / 2],
        [cx2 + transW / 2, cy2 + naveH / 2],
    ] as [number, number][]) {
        g.circle(cpx, cpy, 7).fill(0x2a4a7a);
        g.circle(cpx, cpy, 7).stroke({ width: 1, color: 0x3a5a8a });
    }

    // Altar cross
    g.rect(naveLeft + 2, cy2 - 12, 32, 24).fill(0x2a4060);
    g.rect(naveLeft + 12, cy2 - 12, 4,  24).fill(0xf0c060);
    g.rect(naveLeft + 6,  cy2 - 4,  16,  4).fill(0xf0c060);

    // Rose window
    const roseY = transTop + 22;
    g.circle(cx2, roseY, 16).stroke({ width: 1.5, color: 0x4a80c0 });
    g.circle(cx2, roseY, 14).fill({ color: 0x5080dc, alpha: 0.18 });
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.moveTo(cx2, roseY).lineTo(cx2 + Math.cos(a) * 16, roseY + Math.sin(a) * 16).stroke({ width: 1, color: 0x4a80c0 });
    }

    // Stained-glass windows along nave
    const winColors = [0xc85050, 0x5050c8, 0x50a050, 0xc8a01e];
    for (let i = 0; i < 4; i++) {
        const wx = naveLeft + 50 + i * 55;
        if (wx + 10 > naveRight - 10) break;
        const wyTop = cy2 - naveH / 2 + 2;
        const wyBot = cy2 + naveH / 2 - 21;
        g.circle(wx, wyTop + 9, 9).fill({ color: winColors[i % winColors.length], alpha: 0.3 });
        g.circle(wx, wyBot + 9, 9).fill({ color: winColors[(i + 2) % winColors.length], alpha: 0.3 });
    }

    // Twin spires
    g.poly([naveLeft, transTop + 8,  naveLeft + 10, y + 15,  naveLeft + 20, transTop + 8]).fill(0x2a4a7a);

    c.addChild(g);
    nameplate(c, x + w / 2, y + 22, "CATHEDRAL", SUPPORT.cathedral, 0x93c5fd, 0x1a2e5a);
}

function drawTownHall(c: Container) {
    const { x, y, w, h } = L.town_hall;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x3a1010);

    // Brick texture
    for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 8; col++) {
            const off = row % 2 === 0 ? 0 : 13;
            g.rect(x + off + col * 26, y + 50 + row * 18, 24, 16).fill({ color: 0x501414, alpha: 0.3 });
        }
    }

    // Main body
    g.rect(x + 12, y + 60, w - 24, h - 80).fill(0x5c1e1e);

    // Columns
    for (let i = 0; i < 4; i++) {
        const cx2 = x + 25 + i * 42;
        g.rect(cx2 - 7,  y + 65, 14, h - 90).fill(0x7a3030);
        g.rect(cx2 - 10, y + 63, 20, 6).fill(0x8a3838);
        if (i < 3) {
            g.arc(cx2 + 21, y + 95, 15, Math.PI, 0, false).fill({ color: 0x000000, alpha: 0.4 });
            g.rect(cx2 + 6, y + 95, 30, 30).fill({ color: 0x000000, alpha: 0.4 });
        }
    }

    // Pediment
    g.poly([x + 5, y + 65,  x + w / 2, y + 40,  x + w - 5, y + 65]).fill(0x6a2020);

    // Flag pole + flag
    g.moveTo(x + w / 2, y + 40).lineTo(x + w / 2, y + 18).stroke({ width: 2, color: 0x8a6040 });
    g.poly([x + w / 2, y + 18,  x + w / 2 + 18, y + 26,  x + w / 2, y + 34]).fill(0xcc3030);

    // Steps
    g.rect(x + 18, y + h - 18, w - 36, 6).fill(0x6a2828);
    g.rect(x + 10, y + h - 12, w - 20, 6).fill(0x5a2020);

    c.addChild(g);
    nameplate(c, x + w / 2, y + 24, "TOWN HALL", SUPPORT.town_hall, 0xfca5a5, 0x5a1818);
}

function drawFortress(c: Container) {
    const { x, y, w, h } = L.fortress;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x1c1c18);

    const wallT = 14;
    const wx1 = x + 22, wy1 = y + 38, wx2 = x + w - 22, wy2 = y + h - 22;
    const wallW = wx2 - wx1, wallH = wy2 - wy1;

    // Courtyard + cobblestone
    g.rect(wx1 + wallT, wy1 + wallT, wallW - wallT * 2, wallH - wallT * 2).fill(0x161612);
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 12; col++) {
            g.rect(wx1 + wallT + col * 20, wy1 + wallT + row * 20, 19, 19).stroke({ width: 0.8, color: 0x323223, alpha: 0.2 });
        }
    }

    // Walls
    g.rect(wx1,          wy1,          wallW, wallT).fill(0x2e2c26);
    g.rect(wx1,          wy2 - wallT,  wallW, wallT).fill(0x2e2c26);
    g.rect(wx1,          wy1,          wallT, wallH).fill(0x2e2c26);
    g.rect(wx2 - wallT,  wy1,          wallT, wallH).fill(0x2e2c26);

    // Stone mortar lines on top wall
    for (let i = 0; i < 9; i++) {
        const off = i % 2 === 0 ? 0 : 15;
        g.rect(wx1 + off + i * 30, wy1 + 1, 28, wallT - 2).stroke({ width: 0.8, color: 0x1e1c18 });
    }

    // Battlements (top + bottom walls)
    const mW = 11, mH = 11, mGap = 9, mUnit = mW + mGap;
    const mCount = Math.floor((wallW - 10) / mUnit);
    for (let i = 0; i < mCount; i++) {
        g.rect(wx1 + 5 + i * mUnit, wy1 - mH, mW, mH).fill(0x35332c);
        g.rect(wx1 + 5 + i * mUnit, wy2,       mW, mH).fill(0x35332c);
    }

    // Corner towers
    const tR = 16;
    for (const [tx, ty] of [[wx1, wy1], [wx2, wy1], [wx1, wy2], [wx2, wy2]] as [number, number][]) {
        g.circle(tx, ty, tR).fill(0x3a3830);
        g.circle(tx, ty, tR).stroke({ width: 1.5, color: 0x555555 });
        g.circle(tx, ty, tR - 5).fill(0x201e1a);
        g.rect(tx - 2, ty - 8, 4, 6).fill(0x080808);
        g.rect(tx - 6, ty - 4, 4, 3).fill(0x080808);
        g.rect(tx + 2, ty - 4, 4, 3).fill(0x080808);
    }

    // Portcullis gate
    const gx = x + w / 2;
    g.rect(gx - 11, wy2 - wallT + 1, 22, wallT + 12).fill(0x0a0808);
    g.arc(gx, wy2 - wallT + 1, 11, Math.PI, 0, false).fill(0x0a0808);
    for (let i = -2; i <= 2; i++) {
        g.moveTo(gx + i * 5, wy2 - wallT + 1).lineTo(gx + i * 5, wy2 + 10).stroke({ width: 1.5, color: 0x2a2820 });
    }

    c.addChild(g);
    nameplate(c, x + w / 2, y + 22, "FORTRESS", SUPPORT.fortress, 0xd1d5db, 0x252525);
}

function drawMarket(c: Container) {
    const { x, y, w, h } = L.market;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x3d2208);
    g.rect(x + 10, y + 55, w - 20, 20).fill({ color: 0x64461e, alpha: 0.2 });

    const stallColors = [0x8b2020, 0x1a6020, 0x1a2880, 0x804010];
    const stallW = 40, stallH = 30;
    for (let i = 0; i < 4; i++) {
        const sx = x + 14 + i * 46, sy = y + 45;
        g.rect(sx, sy + stallH - 8, stallW, 8).fill(0x5c3810);
        g.poly([sx - 4, sy,  sx + stallW + 4, sy,  sx + stallW, sy + stallH - 10,  sx, sy + stallH - 10]).fill(stallColors[i % stallColors.length]);
        // Awning stripes
        for (let s = 0; s < 4; s++) {
            g.moveTo(sx + s * 12, sy).lineTo(sx + s * 12 - 4, sy + stallH - 10).stroke({ width: 2, color: 0xffffff, alpha: 0.2 });
        }
        // Goods
        g.circle(sx + 10, sy + stallH - 14, 4).fill(0xf0c060);
        g.circle(sx + 22, sy + stallH - 14, 4).fill(0xe04030);
        g.circle(sx + 34, sy + stallH - 14, 4).fill(0x40a040);
    }

    c.addChild(g);
    nameplate(c, x + w / 2, y + 22, "MARKET", SUPPORT.market, 0xfdba74, 0x4a2c08);
}

function drawHarbor(c: Container) {
    const { x, y, w, h } = L.harbor;
    const g = new Graphics();

    g.roundRect(x, y, w, h, 5).fill(0x0a2040);

    // Waves (simplified horizontal lines)
    for (let row = 0; row < 4; row++) {
        g.moveTo(x + 5, y + 50 + row * 14).lineTo(x + w - 5, y + 50 + row * 14).stroke({ width: 1.5, color: 0x1e50a0, alpha: 0.4 });
    }

    // Dock
    g.rect(x + 10, y + 43, w - 20, 8).fill(0x3a2510);
    for (let p = 0; p < 14; p++) {
        g.moveTo(x + 15 + p * 30, y + 43).lineTo(x + 15 + p * 30, y + 51).stroke({ width: 1, color: 0x2a1808 });
    }

    c.addChild(g);

    // Three ships
    drawShip(c, x + 30,  y + 65, 90);
    drawShip(c, x + 170, y + 65, 90);
    drawShip(c, x + 310, y + 65, 90);

    nameplate(c, x + w / 2, y + 22, "HARBOR", SUPPORT.harbor, 0x7dd3fc, 0x0d2545);
}

// ── Score track ────────────────────────────────────────────────────────────────

function drawScoreTrack(c: Container) {
    const border = new Graphics();
    border.roundRect(0, 0, CW, CH, 8).fill(0x2a1e0a);

    // Wood-grain lines
    for (let i = 0; i < 12; i++) {
        border.moveTo(0, 60 + i * 50).lineTo(CW, 60 + i * 50).stroke({ width: 1, color: 0xffdc78, alpha: 0.05 });
    }

    // Inner playing field
    border.roundRect(TW, TW, CW - TW * 2, CH - TW * 2, 3).fill(0x0d1a0a);

    // Borders
    border.roundRect(1, 1, CW - 2, CH - 2, 8).stroke({ width: 1.5, color: 0xc8a050 });
    border.roundRect(TW - 3, TW - 3, CW - (TW - 3) * 2, CH - (TW - 3) * 2, 3).stroke({ width: 1, color: 0x8b6020 });
    c.addChild(border);

    // Corner ornaments
    const ornG = new Graphics();
    for (const [ox, oy] of [[18, 18], [CW - 18, 18], [CW - 18, CH - 18], [18, CH - 18]] as [number, number][]) {
        ornG.circle(ox, oy, 5).fill(0xc8a050);
        ornG.circle(ox, oy, 8).stroke({ width: 1, color: 0xa07830 });
    }
    c.addChild(ornG);

    // Score numbers along the perimeter
    const innerX = TW, innerY = TW;
    const innerW = CW - TW * 2, innerH = CH - TW * 2;
    const perimeter = 2 * (innerW + innerH);
    const spacing = perimeter / 100;

    for (let n = 1; n <= 99; n++) {
        const dist = (n - 1) * spacing;
        let px: number, py: number, rotate = 0;

        if (dist <= innerW) {
            px = innerX + dist + spacing / 2; py = TW / 2;
        } else if (dist <= innerW + innerH) {
            px = CW - TW / 2; py = innerY + (dist - innerW); rotate = Math.PI / 2;
        } else if (dist <= innerW * 2 + innerH) {
            px = CW - innerX - (dist - innerW - innerH); py = CH - TW / 2;
        } else {
            px = TW / 2; py = CH - innerY - (dist - innerW * 2 - innerH); rotate = -Math.PI / 2;
        }

        // Tick mark
        const tickG = new Graphics();
        const tickLen = n % 5 === 0 ? 5 : 3;
        tickG.moveTo(0, -10).lineTo(0, -10 - tickLen).stroke({
            width: n % 10 === 0 ? 1.5 : 0.8,
            color: n % 5 === 0 ? 0xc8a050 : 0x7a5a28,
        });
        tickG.position.set(px, py);
        tickG.rotation = rotate;
        c.addChild(tickG);

        if (n % 5 === 0) {
            const numT = new Text({
                text: String(n),
                style: makeStyle({
                    fontSize: n % 25 === 0 ? 10 : 8,
                    fontWeight: "bold",
                    fill: n % 25 === 0 ? 0xf0c060 : 0xb08030,
                }),
            });
            numT.anchor.set(0.5);
            numT.position.set(px, py);
            numT.rotation = rotate;
            c.addChild(numT);
        }
    }
}

// ── Central plaza ──────────────────────────────────────────────────────────────

function drawPlaza(c: Container) {
    const px = 265, py = 251, pw = 168, ph = 247;
    const g = new Graphics();

    g.rect(px, py, pw, ph).fill(0x1a2e10);

    // Cobblestone grid
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 5; col++) {
            g.rect(px + 5 + col * 32, py + 5 + row * 27, 30, 25).stroke({ width: 1, color: 0x1e3010 });
        }
    }

    // Promenade path
    const pathY = py + ph / 2 - 18;
    g.rect(px, pathY, pw, 36).fill({ color: 0x285014, alpha: 0.18 });
    g.moveTo(px, pathY).lineTo(px + pw, pathY).stroke({ width: 0.8, color: 0x243a14 });
    g.moveTo(px, pathY + 36).lineTo(px + pw, pathY + 36).stroke({ width: 0.8, color: 0x243a14 });

    // Fountain
    const fx = px + pw / 2, fy = py + ph / 2;
    g.circle(fx, fy, 36).stroke({ width: 2, color: 0x2a5020 });
    g.circle(fx, fy, 34).fill(0x0d3545);
    g.circle(fx, fy, 8).fill(0x3a5030);
    g.circle(fx, fy, 4).fill(0x4a6040);

    // Fountain jets
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.moveTo(fx, fy).lineTo(fx + Math.cos(a) * 27, fy + Math.sin(a) * 27).stroke({ width: 1.5, color: 0x64b4dc, alpha: 0.4 });
    }

    c.addChild(g);

    // Corner trees
    for (const [tx, ty, s] of [
        [px + 20, py + ph * 0.22, 0.7], [px + 20, py + ph * 0.78, 0.7],
        [px + pw - 20, py + ph * 0.22, 0.7], [px + pw - 20, py + ph * 0.78, 0.7],
    ] as [number, number, number][]) {
        drawTree(c, tx, ty, s);
    }
}

// ── Slot layer (recreated on every game-state change) ──────────────────────────

function buildSlotsLayer(
    c: Container,
    locations: BoardLocationData[] | undefined,
    playerColorMap: Record<string, number>,
    selectedSlots: Array<{ locationId: string; slotIndex: number }>,
    onSlotClick: ((locationId: string, slotIndex: number, slot: BoardSlot | null) => void) | undefined,
) {
    const selectedKeys = new Set(selectedSlots.map((s) => `${s.locationId}:${s.slotIndex}`));

    const slotsByLoc: Record<string, BoardSlot[]> = {};
    if (locations) {
        for (const loc of locations) slotsByLoc[loc.locationId] = loc.slots;
    }

    const S = 14; // half-size of each slot tile

    for (const [locId, positions] of Object.entries(SLOTS)) {
        for (let i = 0; i < positions.length; i++) {
            const [cx, cy] = positions[i];
            const slot   = slotsByLoc[locId]?.[i] ?? undefined;
            const isSelected = selectedKeys.has(`${locId}:${i}`);
            const occupied   = slot?.occupiedBy != null;
            const colorIdx   = occupied ? (playerColorMap[slot!.occupiedBy!] ?? 0) : -1;
            const fillColor  = occupied ? SEAT_COLORS_NUM[colorIdx % SEAT_COLORS_NUM.length] : 0xede0b0;

            // ── Drop shadow (offset dark rect underneath) ─────────────────────
            const shadow = new Graphics();
            shadow.roundRect(cx - S + 2, cy - S + 2, S * 2, S * 2, 3).fill({ color: 0x000000, alpha: 0.5 });
            c.addChild(shadow);

            // ── Tile ──────────────────────────────────────────────────────────
            const tile = new Graphics();
            tile.roundRect(cx - S, cy - S, S * 2, S * 2, 3).fill(fillColor);
            // Highlight edge
            tile.roundRect(cx - S, cy - S, S * 2, S * 2, 3).stroke({
                width: 1.5, color: 0xffffff, alpha: occupied ? 0.35 : 0.6,
            });
            // Inner bevel
            tile.roundRect(cx - S + 2, cy - S + 2, S * 2 - 4, S * 2 - 4, 2).stroke({
                width: 1, color: 0x000000, alpha: occupied ? 0.3 : 0.15,
            });
            // Selection ring
            if (isSelected) {
                tile.roundRect(cx - S - 3, cy - S - 3, (S + 3) * 2, (S + 3) * 2, 5).stroke({
                    width: 2.5, color: 0x22c55e,
                });
            }
            c.addChild(tile);

            // ── Username initials ─────────────────────────────────────────────
            if (occupied && slot!.occupiedByUsername) {
                const label = new Text({
                    text: slot!.occupiedByUsername.slice(0, 2).toUpperCase(),
                    style: makeStyle({ fontSize: 8, fontWeight: "bold", fill: "white" }),
                });
                label.anchor.set(0.5);
                label.position.set(cx, cy);
                c.addChild(label);
            }

            // ── Click interaction ─────────────────────────────────────────────
            if (onSlotClick) {
                tile.eventMode = "static";
                tile.cursor    = "pointer";
                tile.hitArea   = new Rectangle(cx - S - 2, cy - S - 2, (S + 2) * 2, (S + 2) * 2);
                const capturedLoc  = locId;
                const capturedIdx  = i;
                const capturedSlot = slot ?? null;
                tile.on("pointerdown", () => onSlotClick(capturedLoc, capturedIdx, capturedSlot));
            }
        }
    }
}

// ── React component ────────────────────────────────────────────────────────────

export default function CityBoardPixi({
    locations,
    playerColorMap = {},
    className = "",
    onSlotClick,
    selectedSlots = [],
}: Props) {
    const mountRef       = useRef<HTMLDivElement>(null);
    const appRef         = useRef<Application | null>(null);
    const slotsContRef   = useRef<Container | null>(null);
    // Stable ref so the slots effect doesn't need onSlotClick as a dependency
    const onClickRef     = useRef(onSlotClick);
    useEffect(() => { onClickRef.current = onSlotClick; }, [onSlotClick]);

    // ── Initialise PixiJS (once) ───────────────────────────────────────────────
    useEffect(() => {
        let mounted = true;
        let app: Application | null = null;

        (async () => {
            if (!mountRef.current) return;

            app = new Application();
            await app.init({
                width:           CW,
                height:          CH,
                backgroundColor: 0x2a1e0a,
                resolution:      Math.min(window.devicePixelRatio || 1, 2),
                autoDensity:     true,
                antialias:       true,
            });

            if (!mounted) {
                app.destroy(true);
                return;
            }

            // Scale the canvas element to always fill the container width
            const canvas = app.canvas as HTMLCanvasElement;
            canvas.style.width   = "100%";
            canvas.style.height  = "auto";
            canvas.style.display = "block";
            mountRef.current.appendChild(canvas);

            appRef.current = app;

            // ── Static background (drawn once, never mutated) ────────────────
            const bg = new Container();
            drawScoreTrack(bg);
            drawPlaza(bg);
            drawPlantation(bg);
            drawTavern(bg);
            drawCathedral(bg);
            drawTownHall(bg);
            drawFortress(bg);
            drawMarket(bg);
            drawHarbor(bg);
            app.stage.addChild(bg);

            // ── Dynamic slots container ──────────────────────────────────────
            const slotsC = new Container();
            slotsC.eventMode = "static"; // enable pointer events for children
            app.stage.addChild(slotsC);
            slotsContRef.current = slotsC;

            // Initial slot draw (empty / no locations yet)
            buildSlotsLayer(slotsC, undefined, {}, [], undefined);
        })();

        return () => {
            mounted = false;
            if (appRef.current) {
                appRef.current.destroy(true);
                appRef.current = null;
            }
            slotsContRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Re-draw slots whenever game state changes ─────────────────────────────
    useEffect(() => {
        const slotsC = slotsContRef.current;
        if (!slotsC) return;
        slotsC.removeChildren();
        buildSlotsLayer(slotsC, locations, playerColorMap, selectedSlots, onClickRef.current);
    }, [locations, playerColorMap, selectedSlots]);

    return (
        <div
            ref={mountRef}
            className={`w-full ${className}`}
            style={{ aspectRatio: `${CW} / ${CH}` }}
        />
    );
}
