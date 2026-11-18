// Costa Solara — drawing only: the world's state and the current screen in,
// pixels out. The 1280x720 view is scaled to fit the window and centred, the
// margin filled with the backdrop colour. The camera follows the player with
// a soft lerp and snaps when the player jumps far (a respawn, a staged shot).
// World space first (sea, sand, roads, buildings, cars, people, particles),
// then the transform is restored to screen space and hud.js draws the HUD.
// Panels (title, paused, game over) and the mission banner are drawn here;
// the HUD itself belongs to hud.js and is never duplicated.

import { CAR, EVENT_HIT, FONT, PALETTE, PLAYER, VIEW, WORLD } from './config.js';
import { drawHud } from './hud.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const PANEL = { width: 680, line: 32 };
const SHIRT_COLORS = ['#e8e4da', '#c94f42', '#3e6fb0', '#d9a441', '#7fae62', '#8a8f96', '#d9b06a', '#b06a8a'];
const TREE_GREEN = ['#5d8a48', '#6f9e57', '#4e7a3e'];

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Deterministic 0..1 hash of a point, for trees, windows and shirt colours. */
function hash01(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** Rounded-rect path (avoids relying on ctx.roundRect existing). */
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function createRenderer(canvas, city) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const cam = { x: 0, y: 0 };
  const fonts = new Map();

  // Local particle pool: smoke from wrecks, dust from handbrake slides, crash bursts.
  const particles = [];
  for (let i = 0; i < 160; i += 1) {
    particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 6, grey: 0 });
  }
  let lastNow = 0;
  let lastSmokeAt = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, weight) {
    const key = size + (weight || '');
    if (!fonts.has(key)) fonts.set(key, (weight ? weight + ' ' : '') + size + 'px ' + FONT);
    ctx.font = fonts.get(key);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.fillText(value, x, y);
    ctx.textAlign = 'left';
  }

  function spawnParticle(x, y, vx, vy, life, size, grey) {
    for (let i = 0; i < particles.length; i += 1) {
      const pt = particles[i];
      if (pt.active) continue;
      pt.active = true;
      pt.x = x;
      pt.y = y;
      pt.vx = vx;
      pt.vy = vy;
      pt.life = life;
      pt.max = life;
      pt.size = size;
      pt.grey = grey;
      return;
    }
  }

  function inView(x, y, margin) {
    return x > cam.x - margin && x < cam.x + VIEW.width + margin &&
      y > cam.y - margin && y < cam.y + VIEW.height + margin;
  }

  function drawGround() {
    const x0 = cam.x - 40;
    const y0 = cam.y - 40;
    const w = VIEW.width + 80;
    const h = VIEW.height + 80;
    // Sand base for the whole visible patch, then sea east and beach south.
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(city.water.x, city.water.y, city.water.w, city.water.h);
    ctx.fillStyle = PALETTE.seaDeep;
    ctx.fillRect(city.water.x + 150, city.water.y, city.water.w - 150, city.water.h);
    // Wave strokes along the shoreline, placed by hash so they never move.
    ctx.strokeStyle = 'rgba(245, 239, 221, 0.35)';
    ctx.lineWidth = 2;
    for (let y = 60; y < WORLD.height; y += 170) {
      if (!inView(city.water.x, y, 60)) continue;
      const off = hash01(7, y) * 40;
      ctx.beginPath();
      ctx.moveTo(city.water.x + 8 + off, y);
      ctx.lineTo(city.water.x + 70 + off, y);
      ctx.stroke();
    }
    ctx.fillStyle = PALETTE.sandDark;
    ctx.fillRect(city.beach.x, city.beach.y, city.beach.w, city.beach.h);
    ctx.fillStyle = 'rgba(245, 239, 221, 0.8)';
    ctx.fillRect(city.beach.x, city.beach.y, city.beach.w, 3);
  }

  function drawParks() {
    for (let i = 0; i < city.parks.length; i += 1) {
      const park = city.parks[i];
      if (!inView(park.x + park.w / 2, park.y + park.h / 2, Math.max(park.w, park.h))) continue;
      ctx.fillStyle = PALETTE.park;
      ctx.fillRect(park.x, park.y, park.w, park.h);
      const trees = 3 + Math.floor(hash01(park.x, park.y) * 4);
      for (let t = 0; t < trees; t += 1) {
        const tx = park.x + 30 + hash01(park.x + t * 13, park.y) * (park.w - 60);
        const ty = park.y + 30 + hash01(park.x, park.y + t * 17) * (park.h - 60);
        ctx.fillStyle = TREE_GREEN[t % TREE_GREEN.length];
        ctx.beginPath();
        ctx.arc(tx, ty, 16 + hash01(tx, ty) * 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b4a2f';
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawRoads() {
    for (let i = 0; i < city.roads.length; i += 1) {
      const road = city.roads[i];
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(road.x - 14, road.y - 14, road.w + 28, road.h + 28);
      ctx.fillStyle = PALETTE.road;
      ctx.fillRect(road.x, road.y, road.w, road.h);
      // Centre dashes.
      ctx.fillStyle = PALETTE.roadLine;
      if (road.horizontal) {
        const cy = road.y + road.h / 2 - 2;
        for (let x = road.x + 8; x < road.x + road.w - 20; x += 46) {
          if (x > cam.x - 40 && x < cam.x + VIEW.width + 40) ctx.fillRect(x, cy, 26, 4);
        }
      } else {
        const cx = road.x + road.w / 2 - 2;
        for (let y = road.y + 8; y < road.y + road.h - 20; y += 46) {
          if (y > cam.y - 40 && y < cam.y + VIEW.height + 40) ctx.fillRect(cx, y, 4, 26);
        }
      }
    }
    // Wooden piers reaching into the sea, plus a few moored boats.
    ctx.fillStyle = '#8a6b46';
    for (let i = 0; i < city.piers.length; i += 1) {
      const pier = city.piers[i];
      ctx.fillRect(pier.x, pier.y, pier.w, pier.h);
      ctx.fillStyle = '#6b4f30';
      for (let x = pier.x + 12; x < pier.x + pier.w; x += 24) ctx.fillRect(x, pier.y, 2, pier.h);
      ctx.fillStyle = '#8a6b46';
    }
    const boats = [[3030, 450], [3080, 740], [3040, 1150], [3090, 1960]];
    for (let i = 0; i < boats.length; i += 1) {
      const bx = boats[i][0];
      const by = boats[i][1];
      if (!inView(bx, by, 60)) continue;
      ctx.fillStyle = '#f2ede0';
      ctx.beginPath();
      ctx.ellipse(bx, by, 22, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a3a38';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by - 26);
      ctx.stroke();
      ctx.fillStyle = '#ff5a4e';
      ctx.beginPath();
      ctx.moveTo(bx, by - 26);
      ctx.lineTo(bx + 12, by - 12);
      ctx.lineTo(bx, by - 12);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawLighthouse() {
    const lm = { x: 3050, y: 400 };
    if (!inView(lm.x, lm.y, 120)) return;
    // Rocky island under the tower.
    ctx.fillStyle = '#9a938a';
    ctx.beginPath();
    ctx.ellipse(lm.x, lm.y + 6, 52, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2ede0';
    ctx.fillRect(lm.x - 13, lm.y - 72, 26, 74);
    ctx.fillStyle = '#c94f42';
    ctx.fillRect(lm.x - 13, lm.y - 56, 26, 12);
    ctx.fillRect(lm.x - 13, lm.y - 28, 26, 12);
    ctx.fillStyle = '#20242a';
    ctx.fillRect(lm.x - 15, lm.y - 80, 30, 10);
    // The lamp, with a soft glow.
    ctx.fillStyle = 'rgba(242, 201, 76, 0.25)';
    ctx.beginPath();
    ctx.arc(lm.x, lm.y - 76, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath();
    ctx.arc(lm.x, lm.y - 76, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBuildings() {
    for (let i = 0; i < city.buildings.length; i += 1) {
      const b = city.buildings[i];
      if (!inView(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      ctx.fillStyle = 'rgba(16, 24, 32, 0.18)';
      ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      // Windows: rows by floors, columns by width.
      const rows = Math.min(b.floors, 3);
      const cols = Math.max(1, Math.floor(b.w / 30));
      ctx.fillStyle = PALETTE.buildingGlass;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (hash01(b.x + c * 7, b.y + r * 11) < 0.2) continue;
          const wx = b.x + 12 + c * ((b.w - 24) / cols);
          const wy = b.y + 12 + r * ((b.h - 24) / rows);
          ctx.fillRect(wx, wy, 11, 13);
        }
      }
    }
  }

  function drawMissionMarker(state, now) {
    const mission = state.mission;
    if (!mission || mission.stage !== 'active' || !mission.target) return;
    const tx = mission.target.x;
    const ty = mission.target.y;
    const sx = tx - cam.x;
    const sy = ty - cam.y;
    if (sx >= 0 && sx <= VIEW.width && sy >= 0 && sy <= VIEW.height) {
      // Pulsing gold ring on the target itself.
      const pulse = 1 + 0.14 * Math.sin(now / 260);
      ctx.strokeStyle = PALETTE.marker;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(tx, ty, 30 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 210, 62, 0.18)';
      ctx.beginPath();
      ctx.arc(tx, ty, 46 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = PALETTE.marker;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      return;
    }
    // Off-screen: a gold arrow pinned to the screen edge, pointing at the target.
    const cx = clamp(sx, 48, VIEW.width - 48);
    const cy = clamp(sy, 48, VIEW.height - 48);
    const angle = Math.atan2(sy - VIEW.height / 2, sx - VIEW.width / 2);
    const ax = cam.x + cx;
    const ay = cam.y + cy;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = PALETTE.marker;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-12, -13);
    ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const dist = Math.round(Math.sqrt((tx - state.player.x) ** 2 + (ty - state.player.y) ** 2));
    ctx.fillStyle = PALETTE.marker;
    ctx.font = '700 14px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(dist + 'm', ax, ay + 30);
    ctx.textAlign = 'left';
  }

  function drawCar(car, now, isPlayer) {
    if (!car.active || !inView(car.x, car.y, 80)) return;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(16, 24, 32, 0.22)';
    rr(ctx, -CAR.length / 2 + 3, -CAR.width / 2 + 4, CAR.length, CAR.width, 9);
    ctx.fill();
    // Body.
    ctx.fillStyle = car.color;
    rr(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 9);
    ctx.fill();
    if (car.mission) {
      ctx.strokeStyle = PALETTE.gold;
      ctx.lineWidth = 3;
      rr(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 9);
      ctx.stroke();
    }
    if (isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      rr(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 9);
      ctx.stroke();
    }
    // Roof and glass.
    if (car.model === 'van') {
      ctx.fillStyle = 'rgba(16, 24, 32, 0.28)';
      rr(ctx, -CAR.length / 2 + 4, -CAR.width / 2 + 3, CAR.length - 10, CAR.width - 6, 7);
      ctx.fill();
    } else if (car.model === 'pickup') {
      ctx.fillStyle = 'rgba(16, 24, 32, 0.3)';
      rr(ctx, -CAR.length / 2 + 3, -CAR.width / 2 + 3, 16, CAR.width - 6, 4);
      ctx.fill();
      ctx.fillStyle = '#26333d';
      rr(ctx, 2, -CAR.width / 2 + 3, 16, CAR.width - 6, 4);
      ctx.fill();
    } else {
      ctx.fillStyle = '#26333d';
      rr(ctx, 6, -CAR.width / 2 + 3, 14, CAR.width - 6, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(16, 24, 32, 0.28)';
      rr(ctx, -16, -CAR.width / 2 + 3, 18, CAR.width - 6, 6);
      ctx.fill();
    }
    // Wheels.
    ctx.fillStyle = '#14181c';
    ctx.fillRect(-20, -CAR.width / 2 - 3, 12, 5);
    ctx.fillRect(8, -CAR.width / 2 - 3, 12, 5);
    ctx.fillRect(-20, CAR.width / 2 - 2, 12, 5);
    ctx.fillRect(8, CAR.width / 2 - 2, 12, 5);
    // Headlights.
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(CAR.length / 2 - 2, -10, 3, 5);
    ctx.fillRect(CAR.length / 2 - 2, 5, 3, 5);
    // Police light bar, flashing red/blue.
    if (car.kind === 'police') {
      const phase = Math.floor(now / 280) % 2 === 0;
      ctx.fillStyle = phase ? '#ff3b30' : '#2b6fd6';
      ctx.fillRect(-6, -CAR.width / 2 + 2, 12, 8);
      ctx.fillStyle = phase ? '#2b6fd6' : '#ff3b30';
      ctx.fillRect(-6, CAR.width / 2 - 10, 12, 8);
    }
    ctx.restore();
    // A white chevron over the player's own car.
    if (isPlayer) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(car.x, car.y - CAR.width / 2 - 22);
      ctx.lineTo(car.x - 8, car.y - CAR.width / 2 - 10);
      ctx.lineTo(car.x + 8, car.y - CAR.width / 2 - 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPed(ped, index) {
    if (!ped.active || !inView(ped.x, ped.y, 40)) return;
    if (ped.state === 'down') {
      ctx.fillStyle = 'rgba(16, 24, 32, 0.2)';
      ctx.beginPath();
      ctx.ellipse(ped.x, ped.y + 3, 13, 7, ped.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a8578';
      ctx.beginPath();
      ctx.ellipse(ped.x, ped.y, 12, 6, ped.angle, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(16, 24, 32, 0.2)';
    ctx.beginPath();
    ctx.ellipse(ped.x, ped.y + 7, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SHIRT_COLORS[index % SHIRT_COLORS.length];
    ctx.beginPath();
    ctx.arc(ped.x, ped.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(ped.x, ped.y - 9, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCop(cop) {
    if (!cop.active || !inView(cop.x, cop.y, 40)) return;
    ctx.fillStyle = 'rgba(16, 24, 32, 0.2)';
    ctx.beginPath();
    ctx.ellipse(cop.x, cop.y + 8, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.police;
    ctx.beginPath();
    ctx.arc(cop.x, cop.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(cop.x, cop.y - 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d2733';
    ctx.beginPath();
    ctx.arc(cop.x, cop.y - 11, 5, Math.PI, 0);
    ctx.fill();
    if (cop.downTimer > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cop.x - 6, cop.y - 20);
      ctx.lineTo(cop.x + 6, cop.y - 8);
      ctx.moveTo(cop.x + 6, cop.y - 20);
      ctx.lineTo(cop.x - 6, cop.y - 8);
      ctx.stroke();
    }
  }

  function drawPlayer(state, now) {
    const p = state.player;
    if (!p.onFoot) return;
    if (!inView(p.x, p.y, 60)) return;
    // Blink while invulnerable after a bust: hidden every other tenth of a second.
    if (p.invulnerable > 0 && Math.floor(p.invulnerable * 10) % 2 === 0) return;
    ctx.fillStyle = 'rgba(16, 24, 32, 0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 10, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.player;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.playerShirt;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(p.angle) * 4, p.y + Math.sin(p.angle) * 4 - 11, 5, 0, Math.PI * 2);
    ctx.fill();
    // Punch swoosh while the fist is out.
    if (p.punchTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (p.punchTimer / PLAYER.punchTime) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 28, p.angle - 0.6, p.angle + 0.6);
      ctx.stroke();
    }
    // Steal progress ring while prying a car door open.
    if (p.stealing > 0) {
      ctx.strokeStyle = 'rgba(16, 24, 32, 0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + (p.stealing / PLAYER.stealTime) * Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawParticles(dt) {
    for (let i = 0; i < particles.length; i += 1) {
      const pt = particles[i];
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy -= 12 * dt;
      const alpha = (pt.life / pt.max) * 0.45;
      ctx.fillStyle = pt.grey === 1
        ? 'rgba(120, 120, 118, ' + alpha + ')'
        : 'rgba(214, 196, 160, ' + alpha + ')';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (1.6 - pt.life / pt.max * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWorld(state, now, dt) {
    drawGround();
    drawParks();
    drawRoads();
    drawLighthouse();
    drawBuildings();
    drawMissionMarker(state, now);
    for (let i = 0; i < state.cars.length; i += 1) {
      const car = state.cars[i];
      drawCar(car, now, car === state.player.car);
    }
    for (let i = 0; i < state.peds.length; i += 1) drawPed(state.peds[i], i);
    for (let i = 0; i < state.cops.length; i += 1) drawCop(state.cops[i]);
    drawPlayer(state, now);

    // Smoke from wrecked cars, dust from a handbrake slide, a burst on a hit.
    if (now - lastSmokeAt > 90) {
      lastSmokeAt = now;
      for (let i = 0; i < state.cars.length; i += 1) {
        const car = state.cars[i];
        if (car.active && car.smoking && inView(car.x, car.y, 60)) {
          spawnParticle(
            car.x + (Math.random() - 0.5) * 16,
            car.y + (Math.random() - 0.5) * 16,
            (Math.random() - 0.5) * 10,
            -22 - Math.random() * 14,
            1.1 + Math.random() * 0.5,
            7 + Math.random() * 5,
            1,
          );
        }
      }
    }
    const p = state.player;
    const input = state.input;
    if (input && input.handbrake && !p.onFoot && p.car && Math.abs(p.car.speed) > 150) {
      const back = p.car.angle + Math.PI;
      spawnParticle(
        p.car.x + Math.cos(back) * 24 + (Math.random() - 0.5) * 10,
        p.car.y + Math.sin(back) * 24 + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 20,
        -6 - Math.random() * 8,
        0.6,
        5 + Math.random() * 3,
        0,
      );
    }
    // A crash burst at the player's car — only while driving; on foot a distant
    // pile-up must not puff smoke around the player.
    if ((state.events & EVENT_HIT) && !p.onFoot && p.car) {
      for (let k = 0; k < 6; k += 1) {
        spawnParticle(
          p.x + (Math.random() - 0.5) * 40,
          p.y + (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 30,
          -10 - Math.random() * 16,
          0.7,
          5 + Math.random() * 4,
          1,
        );
      }
    }
    drawParticles(dt);
  }

  function drawPanel(title, lines, prompt, titleColor) {
    const height = 150 + lines.length * PANEL.line + 70;
    const x = (VIEW.width - PANEL.width) / 2;
    const y = (VIEW.height - height) / 2;
    ctx.fillStyle = 'rgba(16, 24, 32, 0.9)';
    ctx.fillRect(x, y, PANEL.width, height);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, PANEL.width - 2, height - 2);
    ctx.textBaseline = 'alphabetic';
    text(title, VIEW.width / 2, y + 74, 46, titleColor || PALETTE.text, 'center', '700');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], VIEW.width / 2, y + 128 + i * PANEL.line, 19, PALETTE.muted, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 34, 22, PALETTE.gold, 'center', '600');
  }

  function drawBanner(state) {
    const banner = state.banner;
    if (!banner || !banner.text || banner.t <= 0) return;
    ctx.font = '700 22px ' + FONT;
    const width = ctx.measureText(banner.text).width + 56;
    const x = (VIEW.width - width) / 2;
    const y = 104;
    ctx.fillStyle = 'rgba(16, 24, 32, 0.85)';
    ctx.fillRect(x, y, width, 40);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, 38);
    ctx.fillStyle = PALETTE.gold;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, VIEW.width / 2, y + 21);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function money(cash) {
    return '$' + Math.floor(cash || 0).toLocaleString('en-US');
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    const now = performance.now();
    const dt = lastNow === 0 ? 0.016 : clamp((now - lastNow) / 1000, 0, 0.05);
    lastNow = now;

    // Camera: soft follow, snap when the player jumps far.
    const p = state.player;
    const tx = clamp(p.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    const ty = clamp(p.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
    const dx = tx - cam.x;
    const dy = ty - cam.y;
    if (dx * dx + dy * dy > 500 * 500) {
      cam.x = tx;
      cam.y = ty;
    } else {
      cam.x += dx * 0.18;
      cam.y += dy * 0.18;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x - cam.x * view.scale, view.y - cam.y * view.scale);
    drawWorld(state, now, dt);

    // Back to screen space for the HUD and panels.
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      const titleLines = [
        'Mara Voss, new courier for the Solara Swift crew.',
        'Steal cars, outrun the law, run six jobs for Dario.',
        'WASD / arrows drive  •  E steal  •  F punch  •  Space handbrake',
        'P pause  •  M mute',
        best > 0 ? 'Best cash ' + money(best) : 'No runs yet — make your first dollar.',
      ];
      drawPanel('COSTA SOLARA', titleLines, 'Press Enter or click to start');
      return;
    }
    drawHud(ctx, state, city);
    if (screen === SCREEN_PLAY) {
      drawBanner(state);
    } else if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['Take a breath, Mara. The city will wait.'], 'Press P or Enter to resume');
    } else if (screen === SCREEN_OVER) {
      const over = state.gameOver === 'busted' ? 'BUSTED' : 'WASTED';
      drawPanel(
        over,
        ['Cash ' + money(state.cash), 'Best ' + money(Math.max(best, state.cash))],
        'Press Enter to play again',
        PALETTE.danger,
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
