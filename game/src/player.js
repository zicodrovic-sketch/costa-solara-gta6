// Costa Solara — the player: walking, running, stealing cars, punching, exiting.
// Only imports the tuning contract (config.js). The city is passed in by the caller,
// so this module never imports city.js — city.js does not exist in the repo yet.
// The current frame's input is stashed on state.input so stepCars (which has no
// input parameter) can drive the player's car with the same frame's keys.

import { EVENT_PUNCH, EVENT_STEAL, PLAYER, POLICE, WORLD } from './config.js';

/** How close a car must be to start stealing it. */
const STEAL_RANGE = 70;
/** How far the stealing progress may drift from the target before it is cancelled. */
const STEAL_MAX_DIST = 95;
/** Where the player is put when leaving a car: beside it, clear of the door. */
const EXIT_OFFSET = 44;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** True when the point is inside a building; false when the city gives no answer. */
function hitsBuilding(city, x, y) {
  return !!city && typeof city.collidesBuilding === 'function' && city.collidesBuilding(x, y);
}

/**
 * A landmark's {x, y}. city.landmarks may be a map ({Garage: {x, y}}) or a list
 * ([{name, x, y}, ...]); falls back to (fx, fy) when the landmark is missing.
 */
function landmarkPoint(city, name, fx, fy) {
  const marks = city ? city.landmarks : null;
  if (marks) {
    if (Array.isArray(marks)) {
      for (let i = 0; i < marks.length; i += 1) {
        if (marks[i] && marks[i].name === name && Number.isFinite(marks[i].x)) return marks[i];
      }
    } else if (marks[name] && Number.isFinite(marks[name].x)) {
      return marks[name];
    }
  }
  return { x: fx, y: fy };
}

/** The player starts on foot at the Garage landmark, unarmed and healthy. */
export function createPlayer(city) {
  const start = landmarkPoint(city, 'Garage', WORLD.width / 2, WORLD.height / 2);
  return {
    x: start.x,
    y: start.y,
    angle: -Math.PI / 2,
    speed: 0,
    health: PLAYER.health,
    onFoot: true,
    car: null,
    punchTimer: 0,
    punchCooldown: 0,
    invulnerable: 0,
    stealing: 0,
    stealTarget: null,
  };
}

/**
 * One fixed step. Returns an EVENT_* bitmask (never writes state.events; the
 * world merges the flags). While driving the player rides with the car; the
 * exit key puts them back on foot beside it.
 */
export function stepPlayer(state, input, dt, city) {
  const p = state.player;
  state.input = input;
  let events = 0;
  if (p.punchCooldown > 0) p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  if (p.punchTimer > 0) p.punchTimer = Math.max(0, p.punchTimer - dt);
  if (p.invulnerable > 0) p.invulnerable = Math.max(0, p.invulnerable - dt);

  if (p.onFoot) {
    events |= stepOnFoot(state, p, input, dt, city);
  } else {
    const car = p.car;
    if (!car || !car.active) {
      // The car vanished under the player (despawned/wrecked away): back on foot.
      p.onFoot = true;
      p.car = null;
      p.speed = 0;
    } else {
      p.x = car.x;
      p.y = car.y;
      p.angle = car.angle;
      p.speed = car.speed;
      if (input.actionPressed) exitCar(state, p, city);
    }
  }

  // Injury never ends the run here — world.js owns game over. Just clamp.
  p.health = clamp(p.health, 0, PLAYER.health);
  return events;
}

/** Walking, stealing and punching. Returns this frame's EVENT_* flags. */
function stepOnFoot(state, p, input, dt, city) {
  let events = 0;

  // A steal already in progress: stand still beside the car until it is done.
  if (p.stealTarget) {
    const car = p.stealTarget;
    const moved = input.up || input.down || input.left || input.right;
    if (!car.active || car.health <= 0 || moved || dist2(p.x, p.y, car.x, car.y) > STEAL_MAX_DIST * STEAL_MAX_DIST) {
      p.stealing = 0;
      p.stealTarget = null;
    } else {
      p.speed = 0;
      p.stealing += dt;
      if (p.stealing >= PLAYER.stealTime) {
        p.stealing = 0;
        p.stealTarget = null;
        p.onFoot = false;
        p.car = car;
        car.driver = 'player';
        car.kind = 'player';
        state.heat = clamp(state.heat + POLICE.heatStealCar, 0, 100);
        events |= EVENT_STEAL;
      }
    }
    return events;
  }

  // Move: run when the run key is held, face the direction of travel.
  const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (ix !== 0 || iy !== 0) {
    const len = Math.sqrt(ix * ix + iy * iy);
    const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const nx = p.x + (ix / len) * speed * dt;
    const ny = p.y + (iy / len) * speed * dt;
    // Buildings are solid: try the full step, then each axis on its own (slide).
    if (!hitsBuilding(city, nx, ny)) {
      p.x = nx;
      p.y = ny;
    } else {
      if (!hitsBuilding(city, nx, p.y)) p.x = nx;
      if (!hitsBuilding(city, p.x, ny)) p.y = ny;
    }
    p.x = clamp(p.x, PLAYER.radius, WORLD.width - PLAYER.radius);
    p.y = clamp(p.y, PLAYER.radius, WORLD.height - PLAYER.radius);
    p.angle = Math.atan2(iy / len, ix / len);
    p.speed = speed;
  } else {
    p.speed = 0;
  }

  // E: start stealing the nearest drivable car.
  if (input.actionPressed) {
    let best = null;
    let bestD2 = STEAL_RANGE * STEAL_RANGE;
    for (let i = 0; i < state.cars.length; i += 1) {
      const car = state.cars[i];
      if (!car.active || car.health <= 0) continue;
      const d2 = dist2(p.x, p.y, car.x, car.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = car;
      }
    }
    if (best) {
      p.stealing = 0;
      p.stealTarget = best;
    }
  }

  // F: punch what is in front of the player, inside punch range.
  if (input.punchPressed && p.punchCooldown <= 0) {
    p.punchTimer = PLAYER.punchTime;
    p.punchCooldown = PLAYER.punchCooldown;
    const fx = Math.cos(p.angle);
    const fy = Math.sin(p.angle);
    let hit = false;
    for (let i = 0; i < state.peds.length; i += 1) {
      const ped = state.peds[i];
      if (!ped.active || ped.state === 'down') continue;
      const dx = ped.x - p.x;
      const dy = ped.y - p.y;
      if (dx * dx + dy * dy < PLAYER.punchRange * PLAYER.punchRange && dx * fx + dy * fy > 0) {
        ped.state = 'down';
        ped.downTimer = 4;
        ped.speed = 0;
        hit = true;
      }
    }
    for (let i = 0; i < state.cops.length; i += 1) {
      const cop = state.cops[i];
      if (!cop.active || !cop.onFoot || cop.downTimer > 0) continue;
      const dx = cop.x - p.x;
      const dy = cop.y - p.y;
      if (dx * dx + dy * dy < PLAYER.punchRange * PLAYER.punchRange && dx * fx + dy * fy > 0) {
        cop.downTimer = 4;
        cop.speed = 0;
        hit = true;
      }
    }
    if (hit) {
      state.heat = clamp(state.heat + POLICE.heatPunch, 0, 100);
      events |= EVENT_PUNCH;
    }
  }

  return events;
}

/** Leave the car: it becomes an empty civil car, the player stands beside it. */
function exitCar(state, p, city) {
  const car = p.car;
  p.car = null;
  p.onFoot = true;
  p.speed = 0;
  if (!car) return;
  car.driver = 'none';
  car.kind = 'civil';
  const px = Math.cos(car.angle + Math.PI / 2);
  const py = Math.sin(car.angle + Math.PI / 2);
  for (let s = 1; s >= -1; s -= 2) {
    const nx = clamp(car.x + px * EXIT_OFFSET * s, PLAYER.radius, WORLD.width - PLAYER.radius);
    const ny = clamp(car.y + py * EXIT_OFFSET * s, PLAYER.radius, WORLD.height - PLAYER.radius);
    if (hitsBuilding(city, nx, ny)) continue;
    // The clamped spot must still be clear of the car: at a world edge the
    // clamp can crush the offset to nothing, so try the other side instead.
    const dx = nx - car.x;
    const dy = ny - car.y;
    if (dx * dx + dy * dy < 24 * 24) continue;
    p.x = nx;
    p.y = ny;
    return;
  }
  p.x = car.x;
  p.y = car.y;
}
