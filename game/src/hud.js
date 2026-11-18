// Costa Solara — HUD, drawn in screen space (1280x720 VIEW) after render.js restores
// the transform. Reads state only; never calls another render function.
// Layout: cash top-left, wanted stars top-centre, objective banner under the stars,
// minimap top-right, health bar + story log bottom-left, speed bottom-right, hints
// bottom-centre (first 14 seconds only). Minimap scales the 3200x2400 world to 220x150.
import { FONT, PALETTE, POLICE, ROAD, VIEW, WORLD } from './config.js';

const MINIMAP = { x: VIEW.width - 220 - 16, y: 16, w: 220, h: 150 };
const STAR_COUNT = POLICE.maxStars;

/** Format cash with a thousands separator: 1250 -> "$1,250". */
function money(cash) {
  return '$' + Math.floor(cash || 0).toLocaleString('en-US');
}

/** Format a countdown in seconds as m:ss. */
function clock(seconds) {
  const total = Math.max(0, Math.ceil(seconds || 0));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

/** Draw one five-pointed star centred at (cx, cy) with the given outer radius. */
function starPath(ctx, cx, cy, radius) {
  const inner = radius * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Wanted stars, top-centre: gold filled for the current level, grey empty above it. */
function drawWanted(ctx, state) {
  const wanted = Math.max(0, Math.min(STAR_COUNT, state.wanted || 0));
  const size = 13;
  const gap = 30;
  const total = STAR_COUNT * gap - (gap - size * 2);
  let x = (VIEW.width - total) / 2 + size;
  const y = 30;
  for (let i = 0; i < STAR_COUNT; i += 1) {
    ctx.fillStyle = i < wanted ? PALETTE.gold : '#5a5a58';
    ctx.strokeStyle = '#101820';
    ctx.lineWidth = 1.5;
    starPath(ctx, x, y, size);
    ctx.fill();
    ctx.stroke();
    x += gap;
  }
}

/** Objective banner under the stars: mission title, target label, and timer when set. */
function drawObjective(ctx, state) {
  const mission = state.mission;
  if (!mission || mission.stage === 'complete') return;
  const lines = [mission.title + ' — ' + mission.objective];
  if (mission.timer > 0) lines[0] += '  •  ' + clock(mission.timer);
  ctx.font = '600 15px ' + FONT;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 28;
  const x = (VIEW.width - width) / 2;
  const y = 52;
  ctx.fillStyle = 'rgba(16, 24, 32, 0.78)';
  ctx.fillRect(x, y, width, 28);
  ctx.fillStyle = PALETTE.hudText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(lines[0], VIEW.width / 2, y + 15);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Health bar, bottom-left: dark track, green-to-red fill by health 0..100. */
function drawHealth(ctx, state) {
  const health = Math.max(0, Math.min(100, (state.player && state.player.health) || 0));
  const x = 16;
  const y = VIEW.height - 34;
  const w = 220;
  const h = 14;
  ctx.fillStyle = 'rgba(16, 24, 32, 0.78)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#3a3a38';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = health > 50 ? PALETTE.ok : health > 25 ? PALETTE.gold : PALETTE.danger;
  ctx.fillRect(x, y, (w * health) / 100, h);
  ctx.fillStyle = PALETTE.hudText;
  ctx.font = '600 12px ' + FONT;
  ctx.fillText('HP ' + Math.round(health), x + w + 10, y + 12);
}

/** Last four story lines above the health bar, oldest faintest. */
function drawStoryLog(ctx, state) {
  const log = state.storyLog;
  if (!Array.isArray(log) || log.length === 0) return;
  ctx.font = '13px ' + FONT;
  const lines = log.slice(-4);
  const yBase = VIEW.height - 52;
  for (let i = 0; i < lines.length; i += 1) {
    const age = lines.length - 1 - i;
    ctx.fillStyle = `rgba(245, 239, 221, ${1 - age * 0.22})`;
    ctx.fillText(lines[i], 16, yBase - (lines.length - 1 - i) * 18);
  }
}

/** Speed readout, bottom-right, only while driving (player in a car). */
function drawSpeed(ctx, state) {
  const player = state.player;
  if (!player || player.onFoot) return;
  const mph = Math.round(Math.abs(player.speed || 0) * 0.15);
  ctx.font = '700 30px ' + FONT;
  ctx.fillStyle = PALETTE.hudText;
  ctx.textAlign = 'right';
  ctx.fillText(mph + ' mph', VIEW.width - 16, VIEW.height - 16);
  ctx.textAlign = 'left';
}

/** Control hints, bottom-centre, only during the first 14 seconds of a run. */
function drawHints(ctx, state) {
  if ((state.time || 0) >= 14) return;
  ctx.font = '13px ' + FONT;
  ctx.fillStyle = 'rgba(245, 239, 221, 0.85)';
  ctx.textAlign = 'center';
  ctx.fillText('WASD drive • E steal • F punch • P pause', VIEW.width / 2, VIEW.height - 14);
  ctx.textAlign = 'left';
}

/** Minimap, top-right: sand ground, grey road grid, landmark dots, cars, cops, player arrow. */
function drawMinimap(ctx, state, city) {
  const { x, y, w, h } = MINIMAP;
  const sx = w / WORLD.width;
  const sy = h / WORLD.height;
  const px = (wx) => x + wx * sx;
  const py = (wy) => y + wy * sy;

  ctx.fillStyle = 'rgba(16, 24, 32, 0.78)';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(x, y, w, h);

  // Sea along the east edge: the water is x 2960..3200 in the world, so the
  // coastal strip belongs on the minimap's right side, not the left.
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(x + w - 14, y, 14, h);

  // Beach along the south edge: y 2160..2400 in the world is 15px of 150px.
  ctx.fillStyle = PALETTE.sandDark;
  ctx.fillRect(x, y + h - 15, w, 15);

  // Roads: the city grid, one grey line per road (centrelines at 200 + 400k;
  // horizontal roads only run to y 1800, the beach starts at y 2160).
  ctx.strokeStyle = '#8a8578';
  ctx.lineWidth = 1.5;
  for (let gx = 200; gx <= WORLD.width; gx += ROAD.gap) {
    ctx.beginPath();
    ctx.moveTo(px(gx), y);
    ctx.lineTo(px(gx), y + h);
    ctx.stroke();
  }
  for (let gy = 200; gy <= 1800; gy += ROAD.gap) {
    ctx.beginPath();
    ctx.moveTo(x, py(gy));
    ctx.lineTo(x + w, py(gy));
    ctx.stroke();
  }

  // Landmark dots from the city, when available.
  if (city && city.landmarks) {
    ctx.fillStyle = '#6b5a3e';
    for (const name of Object.keys(city.landmarks)) {
      const spot = city.landmarks[name];
      if (!spot) continue;
      ctx.beginPath();
      ctx.arc(px(spot.x), py(spot.y), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Civilian cars as grey dots.
  if (Array.isArray(state.cars)) {
    ctx.fillStyle = '#9a9a96';
    for (const car of state.cars) {
      if (!car || !car.active) continue;
      ctx.fillRect(px(car.x) - 1.5, py(car.y) - 1.5, 3, 3);
    }
  }

  // Cops as blue dots with a red edge.
  if (Array.isArray(state.cops)) {
    for (const cop of state.cops) {
      if (!cop || !cop.active) continue;
      ctx.fillStyle = PALETTE.police;
      ctx.beginPath();
      ctx.arc(px(cop.x), py(cop.y), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.policeLight;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Mission target as a gold star.
  const mission = state.mission;
  if (mission && mission.stage === 'active' && mission.target) {
    ctx.fillStyle = PALETTE.gold;
    ctx.strokeStyle = '#101820';
    ctx.lineWidth = 1;
    starPath(ctx, px(mission.target.x), py(mission.target.y), 6);
    ctx.fill();
    ctx.stroke();
  }

  // Player as a white arrow pointing along the heading.
  const player = state.player;
  if (player) {
    const angle = player.angle || 0;
    const cx = px(player.x);
    const cy = py(player.y);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#101820';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Full HUD in screen space. ctx is already in screen coordinates; nothing is transformed. */
export function drawHud(ctx, state, city) {
  ctx.save();
  try {
    // Cash, top-left.
    ctx.font = '700 26px ' + FONT;
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(money(state.cash), 16, 38);

    drawWanted(ctx, state);
    drawObjective(ctx, state);
    drawMinimap(ctx, state, city);
    drawStoryLog(ctx, state);
    drawHealth(ctx, state);
    drawSpeed(ctx, state);
    drawHints(ctx, state);
  } finally {
    ctx.restore();
  }
}
