// Costa Solara — the police: wanted level, chase cars, foot cops, busts.
// Only imports the tuning contract (config.js). The city is passed in by the
// caller, so this module never imports city.js.
// NOTE: the car-spawn helpers below mirror vehicles.spawnCivilCar on purpose —
// modules may only import config.js and city.js, so police cannot reuse the
// vehicles module and keeps its own copies.

import {
  CAR,
  EVENT_BUSTED,
  EVENT_HIT,
  EVENT_WANTED_DOWN,
  EVENT_WANTED_UP,
  PALETTE,
  POLICE,
  POOLS,
  ROAD,
  TRAFFIC,
  WORLD,
} from './config.js';

/** Cops count as "seeing" the player inside this radius (heat falls slowly). */
const SEEN_RANGE = 550;
/** A foot cop retires once this far from the player with no heat left. */
const FOOT_RETIRE_DIST = 600;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function mod(value, n) {
  return ((value % n) + n) % n;
}

/** The nearest cardinal heading to `angle`. */
function snapCardinal(angle) {
  return Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
}

/** True when the point is inside a building; false when the city gives no answer. */
function hitsBuilding(city, x, y) {
  return !!city && typeof city.collidesBuilding === 'function' && city.collidesBuilding(x, y);
}

/**
 * A point on a road near (x, y). Prefers city.randomRoadPoint; falls back to the
 * nearest road point, then to the spot itself.
 */
function roadPointNear(city, random, x, y, radius) {
  if (city && typeof city.randomRoadPoint === 'function') {
    const pt = city.randomRoadPoint(random, x, y, radius);
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return pt;
  }
  if (city && typeof city.nearestRoadPoint === 'function') {
    const pt = city.nearestRoadPoint(x, y);
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return pt;
  }
  return { x, y };
}

/**
 * A point on a sidewalk near (x, y). Prefers city.randomSidewalkPoint; falls
 * back to a road point nudged onto the verge beside the road.
 */
function sidewalkPointNear(city, random, x, y, radius) {
  if (city && typeof city.randomSidewalkPoint === 'function') {
    const pt = city.randomSidewalkPoint(random, x, y, radius);
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return pt;
  }
  const road = roadPointNear(city, random, x, y, radius);
  const a = random() * Math.PI * 2;
  const off = ROAD.width / 2 + 14;
  return { x: road.x + Math.cos(a) * off, y: road.y + Math.sin(a) * off };
}

/** The foot-cop pool. downTimer > 0 means the cop was punched and is down. */
export function createCops() {
  const cops = [];
  for (let i = 0; i < POOLS.cops; i += 1) {
    cops.push({
      active: false,
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      onFoot: true,
      bustTimer: 0,
      downTimer: 0,
    });
  }
  return cops;
}

/**
 * One fixed step: heat cools (slowly while a cop can see the player, fast when
 * hidden), the wanted level follows the heat, chase cars and foot cops are kept
 * at the level's strength, and busts are timed. Returns an EVENT_* bitmask.
 * No cop spawns while wanted is 0; the ones already out drift off and retire.
 */
export function stepPolice(state, dt, city, random) {
  let events = 0;
  const p = state.player;

  // Heat cools: slowly while any cop is close enough to see the player.
  let seen = false;
  for (let i = 0; i < state.cars.length; i += 1) {
    const car = state.cars[i];
    if (!car.active || car.kind !== 'police') continue;
    const dx = car.x - p.x;
    const dy = car.y - p.y;
    if (dx * dx + dy * dy < SEEN_RANGE * SEEN_RANGE) {
      seen = true;
      break;
    }
  }
  if (!seen) {
    for (let i = 0; i < state.cops.length; i += 1) {
      const cop = state.cops[i];
      if (!cop.active || cop.downTimer > 0) continue;
      const dx = cop.x - p.x;
      const dy = cop.y - p.y;
      if (dx * dx + dy * dy < SEEN_RANGE * SEEN_RANGE) {
        seen = true;
        break;
      }
    }
  }
  state.heat = clamp(
    state.heat - (seen ? POLICE.heatPerSecondSeen : POLICE.heatPerSecondHidden) * dt,
    0,
    100,
  );

  // Wanted level follows the heat; report a change either way.
  const wanted = Math.min(POLICE.maxStars, Math.floor(state.heat / POLICE.heatPerStar));
  if (wanted > state.wanted) events |= EVENT_WANTED_UP;
  else if (wanted < state.wanted) events |= EVENT_WANTED_DOWN;
  state.wanted = wanted;

  events |= stepChaseCars(state, dt, city, random, wanted);
  events |= stepFootCops(state, dt, city, random, wanted);
  return events;
}

/** First free slot in a pool, or null when it is full. */
function freeSlot(pool) {
  for (let i = 0; i < pool.length; i += 1) {
    if (!pool[i].active) return pool[i];
  }
  return null;
}

/**
 * Fill a free car slot with a police chase car on a road a good way from the
 * player (far enough to drive in, close enough to arrive). Returns null when
 * the car pool is full.
 */
function spawnPoliceCar(state, city, random, nearX, nearY) {
  const car = freeSlot(state.cars);
  if (!car) return null;
  const a = random() * Math.PI * 2;
  const pt = roadPointNear(city, random, nearX + Math.cos(a) * 600, nearY + Math.sin(a) * 600, 250);
  car.active = true;
  car.x = pt.x;
  car.y = pt.y;
  car.angle = Math.atan2(nearY - pt.y, nearX - pt.x);
  car.turnTarget = car.angle;
  car.axis = snapCardinal(car.angle);
  car.laneOff = 18;
  car.passTimer = 0;
  car.turnCooldown = 0;
  car.ramCooldown = 0;
  car.chasing = false;
  car.cruise = POLICE.copCarSpeed;
  car.speed = POLICE.copCarSpeed * 0.6;
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  car.color = PALETTE.police;
  car.model = 'police';
  car.kind = 'police';
  car.driver = 'ai';
  car.health = CAR.health;
  car.smoking = false;
  car.mission = false;
  return car;
}

/**
 * Chase cars: spawn up to the wanted level's strength, flag them chasing (the
 * actual pursuit steering lives in vehicles.stepAiCar, so a police car is never
 * moved twice in one frame), and ram the player's car for POLICE.ramDamage
 * (at most once a second). With no heat they stop chasing, cruise as ordinary
 * traffic, and retire once far away; surplus cars (wanted fell) retire
 * farthest-first. Returns an EVENT_* bitmask.
 */
function stepChaseCars(state, dt, city, random, wanted) {
  let events = 0;
  const p = state.player;
  const desired = Math.min(wanted * POLICE.chaseCarsPerStar, POLICE.maxChaseCars);

  let count = 0;
  for (let i = 0; i < state.cars.length; i += 1) {
    const car = state.cars[i];
    if (car.active && car.kind === 'police' && car.driver === 'ai') count += 1;
  }
  while (count < desired) {
    if (!spawnPoliceCar(state, city, random, p.x, p.y)) break;
    count += 1;
  }
  while (count > desired && wanted > 0) {
    let far = null;
    let farD2 = -1;
    for (let i = 0; i < state.cars.length; i += 1) {
      const car = state.cars[i];
      if (!car.active || car.kind !== 'police' || car.driver !== 'ai') continue;
      const dx = car.x - p.x;
      const dy = car.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > farD2) {
        farD2 = d2;
        far = car;
      }
    }
    if (!far) break;
    far.active = false;
    count -= 1;
  }

  for (let i = 0; i < state.cars.length; i += 1) {
    const car = state.cars[i];
    if (!car.active || car.kind !== 'police' || car.driver !== 'ai') continue;
    car.chasing = wanted > 0;
    car.cruise = wanted > 0 ? POLICE.copCarSpeed : TRAFFIC.cruiseSpeed;
    if (car.ramCooldown > 0) car.ramCooldown -= dt;

    // A wreck is towed once the heat is gone (or once it is far away): a dead
    // chase car must never sit in the pool forever.
    const dx0 = car.x - p.x;
    const dy0 = car.y - p.y;
    const far = dx0 * dx0 + dy0 * dy0 > TRAFFIC.despawnBehind * TRAFFIC.despawnBehind;
    if (car.health <= 0) {
      if (wanted === 0 || far) car.active = false;
      continue;
    }
    if (wanted === 0) {
      // No heat: cruise as traffic, retire once far from the player.
      if (far) car.active = false;
      continue;
    }

    // Ram the player's car: damage, a shove, EVENT_HIT, at most once a second.
    if (!p.onFoot && p.car && p.car.active && car.ramCooldown <= 0) {
      const dx = p.car.x - car.x;
      const dy = p.car.y - car.y;
      if (dx * dx + dy * dy < CAR.length * CAR.length) {
        p.car.health -= POLICE.ramDamage;
        if (p.car.health <= 0) {
          p.car.health = 0;
          p.car.smoking = true;
          p.car.speed = 0;
          p.car.vx = 0;
          p.car.vy = 0;
        }
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        p.car.x = clamp(p.car.x + (dx / d) * 6, 0, WORLD.width);
        p.car.y = clamp(p.car.y + (dy / d) * 6, 0, WORLD.height);
        car.ramCooldown = 1.0;
        events |= EVENT_HIT;
      }
    }
  }
  return events;
}

/**
 * Fill a free cop slot with a foot cop on a sidewalk near the player, but not
 * right on top of them. Returns false when the cop pool is full.
 */
function spawnFootCop(state, city, random, nearX, nearY) {
  const cop = freeSlot(state.cops);
  if (!cop) return false;
  const pt = sidewalkPointNear(city, random, nearX, nearY, 480);
  let x = pt.x;
  let y = pt.y;
  const dx = x - nearX;
  const dy = y - nearY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 140) {
    const s = 140 / (d || 1);
    x = nearX + dx * s;
    y = nearY + dy * s;
  }
  cop.active = true;
  cop.x = clamp(x, 0, WORLD.width);
  cop.y = clamp(y, 0, WORLD.height);
  cop.angle = Math.atan2(nearY - cop.y, nearX - cop.x);
  cop.speed = 0;
  cop.onFoot = true;
  cop.bustTimer = 0;
  cop.downTimer = 0;
  return true;
}

/**
 * Foot cops: only while the player is on foot, up to the wanted level's
 * strength. They chase at cop foot speed; holding the player inside bustRange
 * for bustTime raises EVENT_BUSTED. Punched cops (downTimer) lie still, then
 * get back up. With no heat they walk away and retire once far off.
 */
function stepFootCops(state, dt, city, random, wanted) {
  let events = 0;
  const p = state.player;
  const desired = p.onFoot ? Math.min(wanted * POLICE.footCopsPerStar, POLICE.maxFootCops) : 0;

  let count = 0;
  for (let i = 0; i < state.cops.length; i += 1) {
    if (state.cops[i].active) count += 1;
  }
  while (count < desired) {
    if (!spawnFootCop(state, city, random, p.x, p.y)) break;
    count += 1;
  }
  while (count > desired) {
    let far = null;
    let farD2 = -1;
    for (let i = 0; i < state.cops.length; i += 1) {
      const cop = state.cops[i];
      if (!cop.active) continue;
      const dx = cop.x - p.x;
      const dy = cop.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > farD2) {
        farD2 = d2;
        far = cop;
      }
    }
    if (!far) break;
    far.active = false;
    count -= 1;
  }

  for (let i = 0; i < state.cops.length; i += 1) {
    const cop = state.cops[i];
    if (!cop.active) continue;
    if (cop.downTimer > 0) {
      cop.downTimer -= dt;
      cop.speed = 0;
      continue;
    }
    const dx = p.x - cop.x;
    const dy = p.y - cop.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;

    if (wanted === 0) {
      // No heat: walk away from the player, retire once far off.
      cop.angle = Math.atan2(dy, dx) + Math.PI;
      const nx = cop.x - (dx / d) * POLICE.copFootSpeed * 0.5 * dt;
      const ny = cop.y - (dy / d) * POLICE.copFootSpeed * 0.5 * dt;
      if (!hitsBuilding(city, nx, ny)) {
        cop.x = clamp(nx, 0, WORLD.width);
        cop.y = clamp(ny, 0, WORLD.height);
      }
      cop.speed = POLICE.copFootSpeed * 0.5;
      cop.bustTimer = 0;
      if (d > FOOT_RETIRE_DIST) cop.active = false;
      continue;
    }
    if (!p.onFoot) {
      // The player is driving: foot cops wait where they are.
      cop.speed = 0;
      cop.bustTimer = 0;
      continue;
    }

    // Chase on foot; a bust needs bustTime unbroken inside bustRange.
    cop.angle = Math.atan2(dy, dx);
    const nx = cop.x + (dx / d) * POLICE.copFootSpeed * dt;
    const ny = cop.y + (dy / d) * POLICE.copFootSpeed * dt;
    if (!hitsBuilding(city, nx, ny)) {
      cop.x = clamp(nx, 0, WORLD.width);
      cop.y = clamp(ny, 0, WORLD.height);
    }
    cop.speed = POLICE.copFootSpeed;
    if (d < POLICE.bustRange) {
      cop.bustTimer += dt;
      if (cop.bustTimer >= POLICE.bustTime) {
        cop.bustTimer = 0;
        events |= EVENT_BUSTED;
      }
    } else {
      cop.bustTimer = 0;
    }
  }
  return events;
}
