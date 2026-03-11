// components/CityBoard.tsx
//
// Canvas-based city board for Revolution — drawn programmatically like Colonist.io.
// Each location has hand-drawn artwork: ships in the harbor, cross in the cathedral,
// battlements on the fortress, trees at the plantation, stalls at the market, etc.

import { useRef, useEffect } from "react";

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
}

// Must match SEAT_COLORS in GameView.tsx
const SEAT_HEX = ["#3b82f6", "#10b981", "#f97316", "#ec4899", "#06b6d4", "#f43f5e"];

// ── Canvas dimensions ──────────────────────────────────────────────────────────
const CW = 780;  // canvas width
const CH = 720;  // canvas height
const TW = 38;   // score-track band width

// ── Location rects ─────────────────────────────────────────────────────────────
// All coords are in the 780×720 space (score track takes 38px on each side).
const L = {
    plantation: { x: 40,  y: 40,  w: 205, h: 250 },
    tavern:     { x: 265, y: 40,  w: 168, h: 203 },
    cathedral:  { x: 453, y: 40,  w: 289, h: 185 },  // shorter = more horizontal
    town_hall:  { x: 40,  y: 298, w: 205, h: 200 },  // shorter
    fortress:   { x: 453, y: 298, w: 289, h: 200 },  // same top/height as town_hall
    market:     { x: 40,  y: 506, w: 205, h: 170 },  // taller
    harbor:     { x: 265, y: 506, w: 477, h: 170 },  // taller
};

// ── Influence slot centres [cx, cy] ────────────────────────────────────────────
const SLOTS: Record<string, [number, number][]> = {
    plantation: [[84,145],[143,145],[202,145], [84,218],[143,218],[202,218]],
    tavern:     [[307,140],[394,140], [307,210],[394,210]],
    cathedral:  [[504,108],[566,108],[628,108],[690,108], [535,160],[597,160],[659,160]],
    town_hall:  [[90,348],[195,348], [90,398],[195,398], [90,448],[195,448]],
    fortress:   [[517,390],[571,390],[625,390],[679,390], [517,431],[571,431],[625,431],[679,431]],
    market:     [[74,588],[133,588],[192,588], [103,642],[163,642]],
    harbor:     [[325,560],[465,560],[605,560], [325,620],[465,620],[605,620]],
};

// ── Static support values ─────────────────────────────────────────────────────
const SUPPORT: Record<string, number> = {
    plantation:30, tavern:20, cathedral:35, town_hall:45, fortress:50, market:25, harbor:40,
};

// ── Drawing helpers ────────────────────────────────────────────────────────────

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function tree(ctx: CanvasRenderingContext2D, tx: number, ty: number, scale = 1) {
    // Trunk
    ctx.fillStyle = "#6b3a15";
    ctx.fillRect(tx - 3 * scale, ty + 10 * scale, 6 * scale, 16 * scale);
    // Foliage layers
    ctx.fillStyle = "#185c0a";
    ctx.beginPath(); ctx.arc(tx, ty + 4 * scale, 14 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#22700d";
    ctx.beginPath(); ctx.arc(tx, ty - 4 * scale, 10 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2a8c10";
    ctx.beginPath(); ctx.arc(tx, ty - 11 * scale, 7 * scale, 0, Math.PI * 2); ctx.fill();
}

function ship(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw = 80) {
    const sh = sw * 0.45;
    // Hull
    ctx.fillStyle = "#3d2810";
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.1, sy);
    ctx.lineTo(sx + sw * 0.9, sy);
    ctx.quadraticCurveTo(sx + sw, sy + sh * 0.6, sx + sw * 0.85, sy + sh);
    ctx.lineTo(sx + sw * 0.15, sy + sh);
    ctx.quadraticCurveTo(sx, sy + sh * 0.6, sx + sw * 0.1, sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#5c3a18"; ctx.lineWidth = 1.5; ctx.stroke();

    // Mast
    ctx.strokeStyle = "#6b4820"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.5, sy - sh * 1.4);
    ctx.lineTo(sx + sw * 0.5, sy + sh * 0.3);
    ctx.stroke();
    // Yard arm
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.25, sy - sh * 0.9);
    ctx.lineTo(sx + sw * 0.75, sy - sh * 0.9);
    ctx.stroke();

    // Main sail
    ctx.fillStyle = "#c8b07a";
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.5, sy - sh * 1.35);
    ctx.lineTo(sx + sw * 0.76, sy - sh * 0.85);
    ctx.lineTo(sx + sw * 0.76, sy - sh * 0.15);
    ctx.lineTo(sx + sw * 0.5, sy - sh * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#a08050"; ctx.lineWidth = 0.8; ctx.stroke();

    // Foresail
    ctx.fillStyle = "#b09068";
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.5, sy - sh * 1.35);
    ctx.lineTo(sx + sw * 0.26, sy - sh * 0.85);
    ctx.lineTo(sx + sw * 0.5, sy - sh * 0.15);
    ctx.closePath();
    ctx.fill();

    // Flag
    ctx.fillStyle = "#cc2020";
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.5, sy - sh * 1.4);
    ctx.lineTo(sx + sw * 0.65, sy - sh * 1.3);
    ctx.lineTo(sx + sw * 0.5, sy - sh * 1.2);
    ctx.closePath();
    ctx.fill();
}

function nameplate(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    label: string, support: number,
    nameColor: string, plateFill: string
) {
    ctx.font = "bold 14px 'Georgia', serif";
    const tw = ctx.measureText(label).width;
    const pw = tw + 52;
    const ph = 28;

    // Scroll/banner shape
    ctx.fillStyle = plateFill;
    rrect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 3);
    ctx.fill();
    // Folded ends
    ctx.fillStyle = shadeColor(plateFill, -30);
    ctx.beginPath();
    ctx.moveTo(cx - pw / 2, cy - ph / 2 + 4);
    ctx.lineTo(cx - pw / 2 - 7, cy);
    ctx.lineTo(cx - pw / 2, cy + ph / 2 - 4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + pw / 2, cy - ph / 2 + 4);
    ctx.lineTo(cx + pw / 2 + 7, cy);
    ctx.lineTo(cx + pw / 2, cy + ph / 2 - 4);
    ctx.fill();
    // Border
    ctx.strokeStyle = shadeColor(plateFill, 30);
    ctx.lineWidth = 1;
    rrect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 3);
    ctx.stroke();

    // Name
    ctx.fillStyle = nameColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx - 12, cy);

    // Support badge
    ctx.font = "bold 12px system-ui";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`${support}`, cx + pw / 2 - 18, cy);
}

function shadeColor(hex: string, amount: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (n & 0xff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function drawSlot(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    slot: BoardSlot | undefined,
    playerColorMap: Record<string, number>
) {
    const S = 14; // half-size
    const occupied = slot?.occupiedBy != null;
    const colorIdx = occupied ? (playerColorMap[slot!.occupiedBy!] ?? 0) : -1;
    const fill = occupied ? SEAT_HEX[colorIdx % SEAT_HEX.length] : "#ede0b0";

    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Tile face
    ctx.fillStyle = fill;
    rrect(ctx, cx - S, cy - S, S * 2, S * 2, 3);
    ctx.fill();

    ctx.shadowColor = "transparent";

    // Highlight edge (top-left)
    ctx.strokeStyle = occupied ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    rrect(ctx, cx - S, cy - S, S * 2, S * 2, 3);
    ctx.stroke();

    // Inner bevel shadow (bottom-right)
    ctx.strokeStyle = occupied ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    rrect(ctx, cx - S + 2, cy - S + 2, S * 2 - 4, S * 2 - 4, 2);
    ctx.stroke();

    if (occupied && slot!.occupiedByUsername) {
        ctx.fillStyle = "white";
        ctx.font = "bold 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(slot!.occupiedByUsername.slice(0, 2).toUpperCase(), cx, cy);
    }
}

// ── Location drawers ───────────────────────────────────────────────────────────

function drawPlantation(ctx: CanvasRenderingContext2D, r: typeof L.plantation) {
    const { x, y, w, h } = r;
    // Background
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#162e08"); g.addColorStop(1, "#0d1e04");
    ctx.fillStyle = g;
    rrect(ctx, x, y, w, h, 5); ctx.fill();

    // Ground texture – subtle lighter patches
    ctx.fillStyle = "rgba(50,120,15,0.08)";
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(x + 30 + i * 32, y + h * 0.65, 18, 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Cobblestone driveway
    ctx.strokeStyle = "#2a4a12"; ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h - 5);
    ctx.lineTo(x + w / 2, y + h * 0.52);
    ctx.stroke();

    // Manor house
    const mx = x + w / 2 - 38, my = y + 90;
    ctx.fillStyle = "#c8b898"; // cream walls
    ctx.fillRect(mx, my + 18, 76, 52);
    ctx.fillStyle = "#8b6a40"; // wings
    ctx.fillRect(mx - 18, my + 28, 18, 42);
    ctx.fillRect(mx + 76, my + 28, 18, 42);
    // Roof
    ctx.fillStyle = "#5c3a20";
    ctx.beginPath(); ctx.moveTo(mx - 8, my + 18); ctx.lineTo(mx + 38, my - 8); ctx.lineTo(mx + 84, my + 18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#4a2e14";
    ctx.beginPath(); ctx.moveTo(mx - 26, my + 28); ctx.lineTo(mx - 10, my + 18); ctx.lineTo(mx - 10, my + 70); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mx + 102, my + 28); ctx.lineTo(mx + 86, my + 18); ctx.lineTo(mx + 86, my + 70); ctx.closePath(); ctx.fill();
    // Door
    ctx.fillStyle = "#3a2010";
    ctx.fillRect(mx + 30, my + 48, 16, 22);
    // Windows
    ctx.fillStyle = "#f5e060";
    ctx.fillRect(mx + 8, my + 28, 14, 12);
    ctx.fillRect(mx + 54, my + 28, 14, 12);

    // Trees
    tree(ctx, x + 32, y + 70);
    tree(ctx, x + w - 38, y + 68);
    tree(ctx, x + 22, y + 195);
    tree(ctx, x + w - 30, y + 188);
    tree(ctx, x + 55, y + 52);
    tree(ctx, x + w - 58, y + 50, 0.85);

    nameplate(ctx, x + w / 2, y + 24, "PLANTATION", SUPPORT.plantation, "#86efac", "#1e4a0d");
}

function drawTavern(ctx: CanvasRenderingContext2D, r: typeof L.tavern) {
    const { x, y, w, h } = r;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#3d1c0a"); g.addColorStop(1, "#281006");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    // Ground
    ctx.fillStyle = "rgba(120,80,30,0.12)";
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.8, 60, 20, 0, 0, Math.PI * 2); ctx.fill();

    // Building body
    const bx = x + 22, by = y + 68, bw = w - 44, bh = 95;
    ctx.fillStyle = "#6b3a1a";
    ctx.fillRect(bx, by, bw, bh);
    // Timbering
    ctx.strokeStyle = "#3a1e08"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by + 30); ctx.lineTo(bx + bw, by + 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bw / 3, by); ctx.lineTo(bx + bw / 3, by + bh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + (bw * 2) / 3, by); ctx.lineTo(bx + (bw * 2) / 3, by + bh); ctx.stroke();

    // Thatched roof
    ctx.fillStyle = "#7a5820";
    ctx.beginPath();
    ctx.moveTo(x + 10, by);
    ctx.lineTo(x + w / 2, y + 35);
    ctx.lineTo(x + w - 10, by);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#5c4010"; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 10 + i * 12, by);
        ctx.lineTo(x + w / 2, y + 35);
        ctx.stroke();
    }

    // Door
    ctx.fillStyle = "#2a1008";
    ctx.fillRect(bx + bw / 2 - 10, by + bh - 30, 20, 30);
    ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh - 30, 10, Math.PI, 0); ctx.fill();

    // Windows with candlelight glow
    ctx.fillStyle = "#f5e080";
    ctx.shadowColor = "#f0c020"; ctx.shadowBlur = 8;
    ctx.fillRect(bx + 8, by + 8, 16, 14);
    ctx.fillRect(bx + bw - 24, by + 8, 16, 14);
    ctx.shadowColor = "transparent";

    // Sign
    ctx.fillStyle = "#4a2a08";
    ctx.fillRect(x + w / 2 - 28, by - 16, 56, 14);
    ctx.strokeStyle = "#8b5c20"; ctx.lineWidth = 1; ctx.strokeRect(x + w / 2 - 28, by - 16, 56, 14);
    ctx.fillStyle = "#d4a050";
    ctx.font = "bold 8px 'Georgia', serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("THE INN", x + w / 2, by - 9);

    // Barrels
    ctx.fillStyle = "#5c3010";
    ctx.beginPath(); ctx.ellipse(x + 15, y + h - 20, 10, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3a1e08"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 6, y + h - 22); ctx.lineTo(x + 24, y + h - 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y + h - 16); ctx.lineTo(x + 24, y + h - 16); ctx.stroke();

    nameplate(ctx, x + w / 2, y + 22, "TAVERN", SUPPORT.tavern, "#fcd34d", "#5c2c0c");
}

function drawCathedral(ctx: CanvasRenderingContext2D, r: typeof L.cathedral) {
    const { x, y, w, h } = r;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#12203a"); g.addColorStop(1, "#0a1428");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    // Clip everything inside the rect
    ctx.save();
    rrect(ctx, x, y, w, h, 5); ctx.clip();

    // Stone floor checkerboard
    ctx.fillStyle = "rgba(60,80,120,0.08)";
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 10; col++) {
            if ((row + col) % 2 === 0) ctx.fillRect(x + col * 29, y + 30 + row * 28, 28, 27);
        }
    }

    // Landscape cross: WIDE horizontal nave runs L-R; short transept crosses vertically at center
    const cx2 = x + w / 2;   // 597
    const cy2 = y + h / 2;   // 132

    const naveH   = 68;           // height of the wide horizontal nave
    const naveLeft  = x + 14;
    const naveRight = x + w - 14;

    const transW  = 52;           // width of the vertical transept
    const transTop = y + 38;
    const transBot = y + h - 12;

    // Horizontal nave
    ctx.fillStyle = "#1e3460";
    ctx.fillRect(naveLeft, cy2 - naveH / 2, naveRight - naveLeft, naveH);

    // Vertical transept (short, crosses over the nave center)
    ctx.fillRect(cx2 - transW / 2, transTop, transW, transBot - transTop);

    // Crossing columns at the four corners of the intersection
    ctx.fillStyle = "#2a4a7a";
    for (const [cpx, cpy] of [
        [cx2 - transW / 2, cy2 - naveH / 2],
        [cx2 + transW / 2, cy2 - naveH / 2],
        [cx2 - transW / 2, cy2 + naveH / 2],
        [cx2 + transW / 2, cy2 + naveH / 2],
    ] as [number, number][]) {
        ctx.beginPath(); ctx.arc(cpx, cpy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#3a5a8a"; ctx.lineWidth = 1; ctx.stroke();
    }

    // Altar at the far LEFT end of the nave
    ctx.fillStyle = "#2a4060";
    ctx.fillRect(naveLeft + 2, cy2 - 12, 32, 24);
    ctx.fillStyle = "#f0c060";
    ctx.fillRect(naveLeft + 12, cy2 - 12, 4, 24);  // cross vertical
    ctx.fillRect(naveLeft + 6,  cy2 - 4,  16, 4);  // cross horizontal

    // Rose window in transept above the nave crossing
    const roseY = transTop + 22;
    ctx.strokeStyle = "#4a80c0"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx2, roseY, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(100,160,220,0.5)"; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx2, roseY);
        ctx.lineTo(cx2 + Math.cos(a) * 16, roseY + Math.sin(a) * 16); ctx.stroke();
    }
    ctx.fillStyle = "rgba(80,140,200,0.18)";
    ctx.beginPath(); ctx.arc(cx2, roseY, 14, 0, Math.PI * 2); ctx.fill();

    // Stained-glass windows along both sides of the nave (top & bottom edges)
    const winColors = ["rgba(200,80,80,0.3)", "rgba(80,80,200,0.3)", "rgba(80,160,80,0.3)", "rgba(200,160,30,0.28)"];
    const winSpacing = 55;
    for (let i = 0; i < 4; i++) {
        const wx = naveLeft + 50 + i * winSpacing;
        if (wx + 10 > naveRight - 10) break;
        // Top-side window
        const wyTop = cy2 - naveH / 2 + 2;
        ctx.fillStyle = winColors[i % winColors.length];
        ctx.beginPath(); ctx.arc(wx, wyTop + 9, 9, Math.PI, 0);
        ctx.fillRect(wx - 9, wyTop + 9, 18, 12); ctx.fill();
        ctx.strokeStyle = "#3a5a8a"; ctx.lineWidth = 0.8; ctx.stroke();
        // Bottom-side window
        const wyBot = cy2 + naveH / 2 - 21;
        ctx.fillStyle = winColors[(i + 2) % winColors.length];
        ctx.beginPath(); ctx.arc(wx, wyBot + 9, 9, Math.PI, 0);
        ctx.fillRect(wx - 9, wyBot + 9, 18, 12); ctx.fill();
        ctx.strokeStyle = "#3a5a8a"; ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Twin spires at the left end of the nave (the facade towers)
    ctx.fillStyle = "#2a4a7a";
    ctx.beginPath();
    ctx.moveTo(naveLeft,      transTop + 8);
    ctx.lineTo(naveLeft + 10, y + 15);
    ctx.lineTo(naveLeft + 20, transTop + 8);
    ctx.closePath(); ctx.fill();

    ctx.restore();
    nameplate(ctx, x + w / 2, y + 22, "CATHEDRAL", SUPPORT.cathedral, "#93c5fd", "#1a2e5a");
}

function drawTownHall(ctx: CanvasRenderingContext2D, r: typeof L.town_hall) {
    const { x, y, w, h } = r;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#3a1010"); g.addColorStop(1, "#220808");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    ctx.save();
    rrect(ctx, x, y, w, h, 5); ctx.clip();

    // Brick texture
    ctx.fillStyle = "rgba(80,20,20,0.3)";
    for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 8; col++) {
            const off = row % 2 === 0 ? 0 : 13;
            ctx.fillRect(x + off + col * 26, y + 50 + row * 18, 24, 16);
        }
    }

    // Main building body
    ctx.fillStyle = "#5c1e1e";
    ctx.fillRect(x + 12, y + 60, w - 24, h - 80);

    // Imposing facade columns
    const colCount = 4;
    for (let i = 0; i < colCount; i++) {
        const cx2 = x + 25 + i * 42;
        // Column shaft
        ctx.fillStyle = "#7a3030";
        ctx.fillRect(cx2 - 7, y + 65, 14, h - 90);
        // Column capital (top)
        ctx.fillStyle = "#8a3838";
        ctx.fillRect(cx2 - 10, y + 63, 20, 6);
        // Arch between columns
        if (i < colCount - 1) {
            ctx.fillStyle = "rgba(0,0,0,0.4)";
            ctx.beginPath();
            ctx.arc(cx2 + 21, y + 95, 15, Math.PI, 0);
            ctx.fillRect(cx2 + 6, y + 95, 30, 30);
            ctx.fill();
        }
    }

    // Pediment (triangular top)
    ctx.fillStyle = "#6a2020";
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 65);
    ctx.lineTo(x + w / 2, y + 40);
    ctx.lineTo(x + w - 5, y + 65);
    ctx.closePath(); ctx.fill();

    // Flag pole
    ctx.strokeStyle = "#8a6040"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + w / 2, y + 40); ctx.lineTo(x + w / 2, y + 18); ctx.stroke();
    ctx.fillStyle = "#cc3030";
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 18);
    ctx.lineTo(x + w / 2 + 18, y + 26);
    ctx.lineTo(x + w / 2, y + 34);
    ctx.closePath(); ctx.fill();

    // Steps
    ctx.fillStyle = "#6a2828";
    ctx.fillRect(x + 18, y + h - 18, w - 36, 6);
    ctx.fillStyle = "#5a2020";
    ctx.fillRect(x + 10, y + h - 12, w - 20, 6);

    ctx.restore();
    nameplate(ctx, x + w / 2, y + 24, "TOWN HALL", SUPPORT.town_hall, "#fca5a5", "#5a1818");
}

function drawFortress(ctx: CanvasRenderingContext2D, r: typeof L.fortress) {
    const { x, y, w, h } = r;

    // Background
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#1c1c18"); g.addColorStop(1, "#0e0e0a");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    ctx.save();
    rrect(ctx, x, y, w, h, 5); ctx.clip();

    // ── Perimeter walls ────────────────────────────────────────────────────────
    const wallT = 14;
    const wx1 = x + 22, wy1 = y + 38, wx2 = x + w - 22, wy2 = y + h - 22;
    const wallW = wx2 - wx1, wallH = wy2 - wy1;

    // Courtyard floor (dark cobblestone)
    ctx.fillStyle = "#161612";
    ctx.fillRect(wx1 + wallT, wy1 + wallT, wallW - wallT * 2, wallH - wallT * 2);
    ctx.strokeStyle = "rgba(50,50,35,0.2)"; ctx.lineWidth = 1;
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 12; col++) {
            ctx.strokeRect(wx1 + wallT + col * 20, wy1 + wallT + row * 20, 19, 19);
        }
    }

    // Wall fill
    ctx.fillStyle = "#2e2c26";
    ctx.fillRect(wx1, wy1, wallW, wallT);              // top wall
    ctx.fillRect(wx1, wy2 - wallT, wallW, wallT);      // bottom wall
    ctx.fillRect(wx1, wy1, wallT, wallH);              // left wall
    ctx.fillRect(wx2 - wallT, wy1, wallT, wallH);      // right wall

    // Stone mortar lines on top wall
    ctx.strokeStyle = "#1e1c18"; ctx.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) {
        const off = i % 2 === 0 ? 0 : 15;
        ctx.strokeRect(wx1 + off + i * 30, wy1 + 1, 28, wallT - 2);
    }

    // Battlements on top wall
    const mW = 11, mH = 11, mGap = 9, mUnit = mW + mGap;
    const mCount = Math.floor((wallW - 10) / mUnit);
    for (let i = 0; i < mCount; i++) {
        ctx.fillStyle = "#35332c";
        ctx.fillRect(wx1 + 5 + i * mUnit, wy1 - mH, mW, mH);
        ctx.strokeStyle = "#1e1c18"; ctx.lineWidth = 0.5;
        ctx.strokeRect(wx1 + 5 + i * mUnit, wy1 - mH, mW, mH);
    }
    // Battlements on bottom wall
    for (let i = 0; i < mCount; i++) {
        ctx.fillStyle = "#35332c";
        ctx.fillRect(wx1 + 5 + i * mUnit, wy2, mW, mH);
        ctx.strokeStyle = "#1e1c18"; ctx.lineWidth = 0.5;
        ctx.strokeRect(wx1 + 5 + i * mUnit, wy2, mW, mH);
    }

    // ── Four corner towers (circles) ──────────────────────────────────────────
    const tR = 16;
    for (const [tx, ty] of [[wx1, wy1], [wx2, wy1], [wx1, wy2], [wx2, wy2]] as [number, number][]) {
        ctx.fillStyle = "#3a3830";
        ctx.beginPath(); ctx.arc(tx, ty, tR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#555"; ctx.lineWidth = 1.5; ctx.stroke();
        // Tower interior
        ctx.fillStyle = "#201e1a";
        ctx.beginPath(); ctx.arc(tx, ty, tR - 5, 0, Math.PI * 2); ctx.fill();
        // Arrow slit
        ctx.fillStyle = "#080808";
        ctx.fillRect(tx - 2, ty - 8, 4, 6);
        ctx.fillRect(tx - 6, ty - 4, 4, 3);
        ctx.fillRect(tx + 2, ty - 4, 4, 3);
    }

    // ── Portcullis gate in south (bottom) wall ────────────────────────────────
    const gx = x + w / 2;
    ctx.fillStyle = "#0a0808";
    ctx.fillRect(gx - 11, wy2 - wallT + 1, 22, wallT + 12);
    ctx.beginPath(); ctx.arc(gx, wy2 - wallT + 1, 11, Math.PI, 0); ctx.fill();
    // Portcullis bars
    ctx.strokeStyle = "#2a2820"; ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(gx + i * 5, wy2 - wallT + 1);
        ctx.lineTo(gx + i * 5, wy2 + 10);
        ctx.stroke();
    }

    ctx.restore();
    nameplate(ctx, x + w / 2, y + 22, "FORTRESS", SUPPORT.fortress, "#d1d5db", "#252525");
}

function drawMarket(ctx: CanvasRenderingContext2D, r: typeof L.market) {
    const { x, y, w, h } = r;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#3d2208"); g.addColorStop(1, "#281608");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    // Dirt road
    ctx.fillStyle = "rgba(100,70,30,0.2)";
    ctx.fillRect(x + 10, y + 55, w - 20, 20);

    // Market stalls
    const stallColors = ["#8b2020", "#1a6020", "#1a2880", "#804010"];
    const stallW = 40, stallH = 30;
    for (let i = 0; i < 4; i++) {
        const sx = x + 14 + i * 46;
        const sy = y + 45;
        // Counter
        ctx.fillStyle = "#5c3810";
        ctx.fillRect(sx, sy + stallH - 8, stallW, 8);
        // Awning
        ctx.fillStyle = stallColors[i % stallColors.length];
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy);
        ctx.lineTo(sx + stallW + 4, sy);
        ctx.lineTo(sx + stallW, sy + stallH - 10);
        ctx.lineTo(sx, sy + stallH - 10);
        ctx.closePath(); ctx.fill();
        // Awning stripes
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 2;
        for (let s = 0; s < 4; s++) {
            ctx.beginPath();
            ctx.moveTo(sx + s * 12, sy);
            ctx.lineTo(sx + s * 12 - 4, sy + stallH - 10);
            ctx.stroke();
        }
        // Goods on counter
        ctx.fillStyle = "#f0c060";
        ctx.beginPath(); ctx.arc(sx + 10, sy + stallH - 14, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e04030";
        ctx.beginPath(); ctx.arc(sx + 22, sy + stallH - 14, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#40a040";
        ctx.beginPath(); ctx.arc(sx + 34, sy + stallH - 14, 4, 0, Math.PI * 2); ctx.fill();
    }

    nameplate(ctx, x + w / 2, y + 22, "MARKET", SUPPORT.market, "#fdba74", "#4a2c08");
}

function drawHarbor(ctx: CanvasRenderingContext2D, r: typeof L.harbor) {
    const { x, y, w, h } = r;

    // Deep water gradient
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#0a2040"); g.addColorStop(0.5, "#071530"); g.addColorStop(1, "#05101f");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 5); ctx.fill();

    ctx.save();
    rrect(ctx, x, y, w, h, 5); ctx.clip();

    // Wave lines
    ctx.strokeStyle = "rgba(30,80,160,0.4)"; ctx.lineWidth = 1.5;
    for (let row = 0; row < 4; row++) {
        ctx.beginPath();
        let first = true;
        for (let wx = x + 5; wx < x + w - 5; wx += 3) {
            const wy = y + 50 + row * 14 + Math.sin((wx - x) / 18 + row) * 2.5;
            if (first) { ctx.moveTo(wx, wy); first = false; } else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
    }

    // Dock planks
    ctx.fillStyle = "#3a2510";
    ctx.fillRect(x + 10, y + 43, w - 20, 8);
    for (let p = 0; p < 14; p++) {
        ctx.strokeStyle = "#2a1808"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 15 + p * 30, y + 43);
        ctx.lineTo(x + 15 + p * 30, y + 51);
        ctx.stroke();
    }

    // Ships — moved down slightly so masts don't poke above the rect
    ship(ctx, x + 30,  y + 65, 90);
    ship(ctx, x + 170, y + 65, 90);
    ship(ctx, x + 310, y + 65, 90);

    ctx.restore();
    nameplate(ctx, x + w / 2, y + 22, "HARBOR", SUPPORT.harbor, "#7dd3fc", "#0d2545");
}

// ── Score track ────────────────────────────────────────────────────────────────

function drawScoreTrack(ctx: CanvasRenderingContext2D) {
    // Outer border fill
    ctx.fillStyle = "#2a1e0a";
    rrect(ctx, 0, 0, CW, CH, 8);
    ctx.fill();

    // Inner wood grain lines
    ctx.strokeStyle = "rgba(255,220,120,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 60 + i * 50);
        ctx.lineTo(CW, 60 + i * 50);
        ctx.stroke();
    }

    // Inner playing field cutout
    ctx.fillStyle = "#0d1a0a";
    rrect(ctx, TW, TW, CW - TW * 2, CH - TW * 2, 3);
    ctx.fill();

    // Score track numbers
    const innerX = TW, innerY = TW;
    const innerW = CW - TW * 2, innerH = CH - TW * 2;
    const perimeter = 2 * (innerW + innerH);
    const spacing = perimeter / 100;

    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

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
        ctx.save();
        ctx.translate(px, py);
        if (rotate) ctx.rotate(rotate);
        const tickLen = n % 5 === 0 ? 5 : 3;
        ctx.strokeStyle = n % 5 === 0 ? "#c8a050" : "#7a5a28";
        ctx.lineWidth = n % 10 === 0 ? 1.5 : 0.8;
        ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -10 - tickLen); ctx.stroke();

        // Label every 5
        if (n % 5 === 0) {
            ctx.fillStyle = n % 25 === 0 ? "#f0c060" : "#b08030";
            ctx.font = n % 25 === 0 ? "bold 10px system-ui" : "bold 8px system-ui";
            ctx.fillText(n.toString(), 0, 0);
        }
        ctx.restore();
    }

    // Corner ornaments
    const ornamentPositions: [number, number][] = [[18, 18], [CW - 18, 18], [CW - 18, CH - 18], [18, CH - 18]];
    for (const [ox, oy] of ornamentPositions) {
        ctx.fillStyle = "#c8a050";
        ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#a07830"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ox, oy, 8, 0, Math.PI * 2); ctx.stroke();
    }

    // Frame border
    ctx.strokeStyle = "#c8a050"; ctx.lineWidth = 1.5;
    rrect(ctx, 1, 1, CW - 2, CH - 2, 8); ctx.stroke();
    ctx.strokeStyle = "#8b6020"; ctx.lineWidth = 1;
    rrect(ctx, TW - 3, TW - 3, CW - (TW - 3) * 2, CH - (TW - 3) * 2, 3); ctx.stroke();
}

// ── Central plaza ──────────────────────────────────────────────────────────────

function drawPlaza(ctx: CanvasRenderingContext2D) {
    // Plaza now oriented with horizontal path (E-W promenade), trees on left & right edges
    const px = 265, py = 251, pw = 168, ph = 247;
    const g = ctx.createRadialGradient(px + pw / 2, py + ph / 2, 15, px + pw / 2, py + ph / 2, pw / 2);
    g.addColorStop(0, "#1a2e10"); g.addColorStop(1, "#0d1a08");
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);

    // Cobblestone grid
    ctx.strokeStyle = "#1e3010"; ctx.lineWidth = 1;
    for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 5; col++) {
            ctx.strokeRect(px + 5 + col * 32, py + 5 + row * 27, 30, 25);
        }
    }

    // Horizontal promenade path running E-W through the center (lighter band)
    const pathY = py + ph / 2 - 18;
    ctx.fillStyle = "rgba(40,80,20,0.18)";
    ctx.fillRect(px, pathY, pw, 36);
    ctx.strokeStyle = "#243a14"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(px, pathY);     ctx.lineTo(px + pw, pathY);     ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, pathY + 36); ctx.lineTo(px + pw, pathY + 36); ctx.stroke();

    // Fountain at center
    const fx = px + pw / 2, fy = py + ph / 2;
    ctx.strokeStyle = "#2a5020"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fx, fy, 36, 0, Math.PI * 2); ctx.stroke();
    const wg = ctx.createRadialGradient(fx, fy, 5, fx, fy, 34);
    wg.addColorStop(0, "#1a5060"); wg.addColorStop(1, "#0d2535");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.arc(fx, fy, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a5030";
    ctx.beginPath(); ctx.arc(fx, fy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4a6040";
    ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(100,180,220,0.4)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo(fx + Math.cos(a) * 18, fy + Math.sin(a) * 18 - 8, fx + Math.cos(a) * 27, fy + Math.sin(a) * 27);
        ctx.stroke();
    }

    // Trees on left and right edges — the "rotated" orientation has them flanking the sides
    tree(ctx, px + 20,       py + ph * 0.22, 0.7);
    tree(ctx, px + 20,       py + ph * 0.78, 0.7);
    tree(ctx, px + pw - 20,  py + ph * 0.22, 0.7);
    tree(ctx, px + pw - 20,  py + ph * 0.78, 0.7);
}

// ── Main draw function ─────────────────────────────────────────────────────────

function drawAll(
    ctx: CanvasRenderingContext2D,
    locations: BoardLocationData[] | undefined,
    playerColorMap: Record<string, number>
) {
    ctx.clearRect(0, 0, CW, CH);

    drawScoreTrack(ctx);
    drawPlaza(ctx);
    drawPlantation(ctx, L.plantation);
    drawTavern(ctx, L.tavern);
    drawCathedral(ctx, L.cathedral);
    drawTownHall(ctx, L.town_hall);
    drawFortress(ctx, L.fortress);
    drawMarket(ctx, L.market);
    drawHarbor(ctx, L.harbor);

    // Build live slot lookup
    const slotsByLoc: Record<string, BoardSlot[]> = {};
    if (locations) {
        for (const loc of locations) slotsByLoc[loc.locationId] = loc.slots;
    }

    // Draw influence slots
    for (const [locId, positions] of Object.entries(SLOTS)) {
        const liveSlots = slotsByLoc[locId];
        for (let i = 0; i < positions.length; i++) {
            const [cx2, cy2] = positions[i];
            drawSlot(ctx, cx2, cy2, liveSlots?.[i], playerColorMap);
        }
    }
}

// ── React component ────────────────────────────────────────────────────────────

export default function CityBoard({ locations, playerColorMap = {}, className = "" }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width  = CW * dpr;
        canvas.height = CH * dpr;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.scale(dpr, dpr);
        drawAll(ctx, locations, playerColorMap);
    }, [locations, playerColorMap]);

    return (
        <canvas
            ref={canvasRef}
            className={`w-full h-auto ${className}`}
            style={{ display: "block" }}
        />
    );
}
