// Costa Solara — street life: civil traffic density and pedestrians.
// Only imports the tuning contract (config.js). The city is passed in by the
// caller, so this module never imports city.js.
// NOTE: the civil-car spawn helper below mirrors vehicles.spawnCivilCar on
// purpose — modules may only import config.js and city.js, so traffic cannot
// reuse the vehicles module and keeps its own copy.

import { CAR, EVENT_HIT, PEDESTRIANS, POOLS, ROAD, TRAFFIC, WORLD } from './config.js';

/** Heat gained for running a pedestrian down. */
const HIT_HEAT = 6;
/** A 'down' pedestrian gets up after this many seconds, then flees. */
const DOWN_SECONDS = 4;
/** How far a pedestrian flees before calming down. */
const FLEE_SECONDS = 2.5;
/** Pedestrians farther than this from the player are recycled. */
const PED_DESPAWN = 1300;
/** Civil paint jobs and body styles, picked at spawn (same set as vehicles.js). */
const CAR_COLORS = ['#e8e4da', '#c94f42', '#3e6fb0', '#d9a441', '#7fae62', '#8a8f96', '#20242a', '#d9b06a'];
const CAR_MODELS = ['sedan', 'hatch', 'coupe', 'van', 'pickup'];

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function mod(value, n) {
  return ((value % n) + n) % n;
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

/** A cardinal heading that follows the road grid at (x, y). */
function roadAngle(x, y, random) {
  // Road centrelines sit at 200 + 400k, not at multiples of 400: measure the
  // distance to the nearest centreline, not to the nearest block edge.
  const dx = Math.min(mod(x - 200, ROAD.gap), ROAD.gap - mod(x - 200, ROAD.gap));
  const dy = Math.min(mod(y - 200, ROAD.gap), ROAD.gap - mod(y - 200, ROAD.gap));
  if (dx <= dy) return random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  return random() < 0.5 ? 0 : Math.PI;
}

/** The pedestrian pool. tx/ty is the current walk (or flee) destination. */
export function createTraffic() {
  const peds = [];
  for (let i = 0; i < POOLS.peds; i += 1) {
    peds.push({
      active: false,
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      state: 'walk',
      downTimer: 0,
      fleeTimer: 0,
      cruise: PEDESTRIANS.walkSpeed,
      tx: 0,
      ty: 0,
    });
  }
  return peds;
}

/** First free slot in a pool, or null when it is full. */
function freeSlot(pool) {
  for (let i = 0; i < pool.length; i += 1) {
    if (!pool[i].active) return pool[i];
  }
  return null;
}

/** Fill a free car slot with a civil AI car on a road near (nearX, nearY). */
function spawnCivilCarHere(state, city, random, nearX, nearY) {
  const car = freeSlot(state.cars);
  if (!car) return null;
  const pt = roadPointNear(city, random, nearX, nearY, 500);
  car.active = true;
  car.x = pt.x;
  car.y = pt.y;
  car.angle = roadAngle(pt.x, pt.y, random);
  car.turnTarget = car.angle;
  car.axis = car.angle;
  car.laneOff = 18;
  car.passTimer = 0;
  car.turnCooldown = 0;
  car.ramCooldown = 0;
  car.chasing = false;
  car.cruise = TRAFFIC.cruiseSpeed + (random() * 2 - 1) * TRAFFIC.cruiseJitter;
  car.speed = car.cruise;
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  car.color = CAR_COLORS[(random() * CAR_COLORS.length) | 0];
  car.model = CAR_MODELS[(random() * CAR_MODELS.length) | 0];
  car.kind = 'civil';
  car.driver = 'ai';
  car.health = CAR.health;
  car.smoking = false;
  car.mission = false;
  return car;
}

/** Fill a free pedestrian slot with a walker on a sidewalk near the player. */
function spawnPed(state, city, random, nearX, nearY) {
  const ped = freeSlot(state.peds);
  if (!ped) return false;
  const pt = sidewalkPointNear(city, random, nearX, nearY, 800);
  ped.active = true;
  ped.x = pt.x;
  ped.y = pt.y;
  ped.state = 'walk';
  ped.downTimer = 0;
  ped.fleeTimer = 0;
  ped.cruise = PEDESTRIANS.walkSpeed + (random() * 2 - 1) * PEDESTRIANS.walkJitter;
  ped.speed = ped.cruise;
  ped.angle = random() * Math.PI * 2;
  const dest = sidewalkPointNear(city, random, pt.x, pt.y, 400);
  ped.tx = dest.x;
  ped.ty = dest.y;
  return true;
}

/**
 * Keep TRAFFIC.cars civil cars active near the player: spawn on roads inside
 * the spawn radius, retire the ones far behind. Mission cars are never retired.
 * Returns 0 — traffic density raises no events of its own.
 */
export function stepTraffic(state, dt, city, random) {
  const p = state.player;
  // Retire the far ones first, then top the count back up: the count at the
  // end of this call is exactly TRAFFIC.cars (when the pool allows it).
  const despawn2 = TRAFFIC.despawnBehind * TRAFFIC.despawnBehind;
  for (let i = 0; i < state.cars.length; i += 1) {
    const car = state.cars[i];
    if (!car.active || car.kind !== 'civil' || car.driver !== 'ai' || car.mission) continue;
    const dx = car.x - p.x;
    const dy = car.y - p.y;
    if (dx * dx + dy * dy > despawn2) car.active = false;
  }
  let civil = 0;
  for (let i = 0; i < state.cars.length; i += 1) {
    const car = state.cars[i];
    if (car.active && car.kind === 'civil' && car.driver === 'ai') civil += 1;
  }
  while (civil < TRAFFIC.cars) {
    if (!spawnCivilCarHere(state, city, random, p.x, p.y)) break;
    civil += 1;
  }
  return 0;
}

/**
 * One fixed step for every pedestrian: stroll the sidewalks, flee the player's
 * speeding car and any nearby trouble, lie 'down' when run over (or punched)
 * and get up fleeing after DOWN_SECONDS. Returns an EVENT_* bitmask.
 */
export function stepPedestrians(state, dt, city, random) {
  let events = 0;
  const p = state.player;

  let count = 0;
  for (let i = 0; i < state.peds.length; i += 1) {
    if (state.peds[i].active) count += 1;
  }
  while (count < PEDESTRIANS.count) {
    if (!spawnPed(state, city, random, p.x, p.y)) break;
    count += 1;
  }

  const playerCar = !p.onFoot && p.car && p.car.active ? p.car : null;
  const despawn2 = PED_DESPAWN * PED_DESPAWN;

  for (let i = 0; i < state.peds.length; i += 1) {
    const ped = state.peds[i];
    if (!ped.active) continue;
    const dxp = ped.x - p.x;
    const dyp = ped.y - p.y;
    const d2p = dxp * dxp + dyp * dyp;
    if (d2p > despawn2) {
      ped.active = false;
      continue;
    }
    // Keep the pedestrian inside the world even while down: a downed ped
    // placed off the map edge must not stay there.
    ped.x = clamp(ped.x, 0, WORLD.width);
    ped.y = clamp(ped.y, 0, WORLD.height);

    // Run over by the player's moving car: down, heat, EVENT_HIT.
    if (playerCar && Math.abs(playerCar.speed) > 30 && ped.state !== 'down') {
      const dx = ped.x - playerCar.x;
      const dy = ped.y - playerCar.y;
      if (dx * dx + dy * dy < CAR.width * CAR.width) {
        ped.state = 'down';
        ped.downTimer = DOWN_SECONDS;
        ped.speed = 0;
        state.heat = clamp(state.heat + HIT_HEAT, 0, 100);
        events |= EVENT_HIT;
        continue;
      }
    }

    if (ped.state === 'down') {
      ped.speed = 0;
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) startFlee(ped, p);
      continue;
    }

    // Trouble nearby: a fast car closing in, a wanted player, a punch mid-swing.
    if (ped.state === 'walk') {
      let threat = false;
      if (playerCar && Math.abs(playerCar.speed) > 120 && d2p < 170 * 170) threat = true;
      if (!threat && state.wanted > 0 && d2p < 200 * 200) threat = true;
      if (!threat && p.punchTimer > 0 && d2p < 90 * 90) threat = true;
      if (threat) startFlee(ped, p);
    }

    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const arrived = moveToward(ped, dt, PEDESTRIANS.fleeSpeed);
      if (ped.fleeTimer <= 0 || arrived) {
        ped.state = 'walk';
        ped.speed = ped.cruise;
        const dest = sidewalkPointNear(city, random, ped.x, ped.y, 400);
        ped.tx = dest.x;
        ped.ty = dest.y;
      }
    } else {
      const arrived = moveToward(ped, dt, ped.cruise);
      if (arrived) {
        const dest = sidewalkPointNear(city, random, ped.x, ped.y, 400);
        ped.tx = dest.x;
        ped.ty = dest.y;
      }
    }

    // Never end up inside a building: pick a fresh destination and step back.
    if (hitsBuilding(city, ped.x, ped.y)) {
      const dest = sidewalkPointNear(city, random, ped.x, ped.y, 300);
      ped.tx = dest.x;
      ped.ty = dest.y;
    }
    ped.x = clamp(ped.x, 0, WORLD.width);
    ped.y = clamp(ped.y, 0, WORLD.height);
  }
  return events;
}

/** Send a pedestrian running away from the player for FLEE_SECONDS. */
function startFlee(ped, p) {
  ped.state = 'flee';
  ped.fleeTimer = FLEE_SECONDS;
  let dx = ped.x - p.x;
  let dy = ped.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) {
    dx = 1;
    dy = 0;
  } else {
    dx /= d;
    dy /= d;
  }
  // Run where there is room: straight away first, then either side, then back
  // toward the player as a last resort (a dead end still beats standing still).
  for (let k = 0; k < 4; k += 1) {
    let ox = dx;
    let oy = dy;
    if (k === 1) {
      ox = -dy;
      oy = dx;
    } else if (k === 2) {
      ox = dy;
      oy = -dx;
    } else if (k === 3) {
      ox = -dx;
      oy = -dy;
    }
    const tx = clamp(ped.x + ox * 260, 0, WORLD.width);
    const ty = clamp(ped.y + oy * 260, 0, WORLD.height);
    const ex = tx - ped.x;
    const ey = ty - ped.y;
    if (ex * ex + ey * ey > 80 * 80) {
      ped.tx = tx;
      ped.ty = ty;
      ped.angle = Math.atan2(ey, ex);
      return;
    }
  }
  ped.tx = ped.x;
  ped.ty = ped.y;
}

/** Walk toward (tx, ty) at `speed`; true when the destination is reached. */
function moveToward(ped, dt, speed) {
  const dx = ped.tx - ped.x;
  const dy = ped.ty - ped.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return true;
  const step = Math.min(d, speed * dt);
  ped.x += (dx / d) * step;
  ped.y += (dy / d) * step;
  ped.angle = Math.atan2(dy, dx);
  ped.speed = speed;
  return d - step < 12;
}
