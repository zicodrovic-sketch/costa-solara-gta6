// Costa Solara — cars: the pool, spawning, player driving physics, AI traffic
// driving, and collisions. Only imports the tuning contract (config.js). The city
// is passed in by the caller, so this module never imports city.js.
// The player's input arrives via state.input, stashed there by stepPlayer
// (stepCars has no input parameter); with no input the car simply coasts.

import { CAR, EVENT_HIT, POLICE, POOLS, ROAD, TRAFFIC, WORLD } from './config.js';

/** Civil paint jobs and body styles, picked at spawn. */
const CAR_COLORS = ['#e8e4da', '#c94f42', '#3e6fb0', '#d9a441', '#7fae62', '#8a8f96', '#20242a', '#d9b06a'];
const CAR_MODELS = ['sedan', 'hatch', 'coupe', 'van', 'pickup'];

/** How far right of the road centre a car drives (right-hand traffic). */
const LANE = 18;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function mod(value, n) {
  return ((value % n) + n) % n;
}

/** Wrap an angle to (-PI, PI]. */
function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** Turn `angle` toward `target` by at most `maxStep` radians. */
function turnToward(angle, target, maxStep) {
  let diff = normAngle(target - angle);
  if (diff > maxStep) diff = maxStep;
  else if (diff < -maxStep) diff = -maxStep;
  return angle + diff;
}

/** True when the point is inside a building; false when the city gives no answer. */
function hitsBuilding(city, x, y) {
  return !!city && typeof city.collidesBuilding === 'function' && city.collidesBuilding(x, y);
}

/**
 * A point on a road near (x, y). Prefers city.randomRoadPoint; falls back to the
 * nearest road point, then to the spot itself. Extra arguments are harmless when
 * the city's function takes fewer.
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
 * A cardinal heading that follows the road grid at (x, y): vertical roads run
 * north/south, horizontal roads east/west. Roads repeat every ROAD.gap units.
 */
function roadAngle(x, y, random) {
  // Road centrelines sit at 200 + 400k, not at multiples of 400: measure the
  // distance to the nearest centreline, not to the nearest block edge.
  const dx = Math.min(mod(x - 200, ROAD.gap), ROAD.gap - mod(x - 200, ROAD.gap));
  const dy = Math.min(mod(y - 200, ROAD.gap), ROAD.gap - mod(y - 200, ROAD.gap));
  if (dx <= dy) return random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
  return random() < 0.5 ? 0 : Math.PI;
}

/** The car pool: one slot will hold the player's car, the rest civil/police. */
export function createCars() {
  const cars = [];
  for (let i = 0; i < POOLS.cars; i += 1) {
    cars.push({
      active: false,
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      vx: 0,
      vy: 0,
      color: CAR_COLORS[0],
      model: CAR_MODELS[0],
      kind: 'civil',
      driver: 'none',
      health: CAR.health,
      smoking: false,
      mission: false,
      cruise: TRAFFIC.cruiseSpeed,
      turnTarget: 0,
      turnCooldown: 0,
      ramCooldown: 0,
      /** Cooldown between crash-damage impacts, so one pile-up cannot melt a car. */
      crashCooldown: 0,
      /** True while a police car is actively chasing the player (see stepAiCar). */
      chasing: false,
      /** The road direction this AI car is following (a cardinal heading). */
      axis: 0,
      /** Lateral offset from the road centre: +LANE is the right-hand lane. */
      laneOff: 18,
      /** Seconds left of an overtake (0 when not passing). */
      passTimer: 0,
    });
  }
  return cars;
}

/** First free slot in the pool, or null when every car is out. */
function freeCar(state) {
  for (let i = 0; i < state.cars.length; i += 1) {
    if (!state.cars[i].active) return state.cars[i];
  }
  return null;
}

/** Fill a free slot with a civil AI car on a road near (nearX, nearY). */
export function spawnCivilCar(state, city, random, nearX, nearY) {
  const car = freeCar(state);
  if (!car) return null;
  const pt = roadPointNear(city, random, nearX, nearY, 500);
  car.active = true;
  car.x = pt.x;
  car.y = pt.y;
  car.angle = roadAngle(pt.x, pt.y, random);
  car.turnTarget = car.angle;
  car.axis = car.angle;
  car.laneOff = LANE;
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

/**
 * One fixed step for every car. Returns an EVENT_* bitmask (EVENT_HIT when cars
 * crash into each other or the player's car runs a pedestrian down; the
 * pedestrian's fall and the heat for it are traffic.js's job).
 */
export function stepCars(state, dt, city, random) {
  let events = 0;
  const cars = state.cars;
  const input = state.input || null;

  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i];
    if (!car.active) continue;
    if (car.health <= 0) {
      // Wrecked: smokes and cannot move.
      car.health = 0;
      car.smoking = true;
      car.speed = 0;
      car.vx = 0;
      car.vy = 0;
      continue;
    }
    if (car.crashCooldown > 0) car.crashCooldown -= dt;
    const px = car.x;
    const py = car.y;
    if (car === state.player.stealTarget) {
      // Being stolen: held still beside the player until the steal finishes.
      car.speed = 0;
      car.vx = 0;
      car.vy = 0;
      continue;
    }
    if (car.driver === 'player') stepPlayerCar(car, input, dt);
    else if (car.driver === 'ai') stepAiCar(car, dt, city, random, cars, state);
    else stepDriverlessCar(car, dt);
    car.x = clamp(car.x, 0, WORLD.width);
    car.y = clamp(car.y, 0, WORLD.height);

    // Buildings are solid: back out, stop, take scrape damage, bounce a little.
    const fx = car.x + Math.cos(car.angle) * (CAR.length / 2);
    const fy = car.y + Math.sin(car.angle) * (CAR.length / 2);
    if (hitsBuilding(city, car.x, car.y) || hitsBuilding(city, fx, fy)) {
      car.x = clamp(px - Math.cos(car.angle) * 4, 0, WORLD.width);
      car.y = clamp(py - Math.sin(car.angle) * 4, 0, WORLD.height);
      car.speed = 0;
      car.vx = 0;
      car.vy = 0;
      car.health -= CAR.scrapeDamage * dt;
      if (car.driver === 'ai') {
        // Abandon the turn: go straight along the nearest cardinal instead of
        // grinding the same corner, and don't decide another turn for a second.
        car.axis = snapCardinal(car.angle);
        car.turnCooldown = 1.0;
      }
      if (car.kind === 'police' && car.chasing) {
        // Swerve toward the player's side so the chase slides along the wall
        // instead of grinding head-on into it.
        const toPx = state.player.x - car.x;
        const toPy = state.player.y - car.y;
        const left = -Math.sin(car.angle) * toPx + Math.cos(car.angle) * toPy;
        car.angle += left >= 0 ? 0.7 : -0.7;
      }
      if (car.health <= 0) {
        car.health = 0;
        car.smoking = true;
      }
    }
  }

  events |= collideCars(cars, state.player.stealTarget || null);
  events |= checkPedHits(state);
  return events;
}

/**
 * The player's car. Velocity is a vector (vx, vy): forward speed comes from the
 * engine/brakes, the sideways part decays with CAR.grip, and the handbrake
 * loosens the grip so the tail slides while the turn sharpens.
 */
function stepPlayerCar(car, input, dt) {
  const up = !!input && !!input.up;
  const down = !!input && !!input.down;
  const steer = !!input ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
  const handbrake = !!input && !!input.handbrake;

  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  let fwd = car.vx * cos + car.vy * sin;
  let lat = -car.vx * sin + car.vy * cos;

  if (up) fwd += CAR.accel * dt;
  else if (down) {
    if (fwd > 1) fwd -= CAR.brake * dt;
    else fwd -= CAR.reverseAccel * dt;
  } else {
    fwd -= fwd * 0.35 * dt;
    if (fwd > -2 && fwd < 2) fwd = 0;
  }
  if (handbrake) fwd -= fwd * 1.6 * dt;
  fwd = clamp(fwd, -CAR.maxReverse, CAR.maxSpeed);

  // Steering bites in proportion to speed (and reverses when reversing).
  const bite = clamp(fwd / 220, -1, 1);
  car.angle += steer * CAR.turnRate * (handbrake ? 1.35 : 1) * bite * dt;

  const grip = handbrake ? CAR.grip * 0.35 : CAR.grip;
  lat *= Math.exp(-grip * dt);

  const c2 = Math.cos(car.angle);
  const s2 = Math.sin(car.angle);
  car.vx = c2 * fwd - s2 * lat;
  car.vy = s2 * fwd + c2 * lat;
  car.speed = fwd;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

/**
 * An AI car. Civil cars follow the road grid in the right-hand lane (straight
 * on their road, a random turn at intersections), ease off for a car ahead in
 * their lane, and pass a stopped one on the left. A police car with chasing
 * set (police.js) instead steers at the player at cop speed — the chase lives
 * here so a police car is never moved twice in one frame by two modules.
 */
function stepAiCar(car, dt, city, random, cars, state) {
  car.turnCooldown -= dt;
  if (car.passTimer > 0) car.passTimer -= dt;
  const chasing = car.kind === 'police' && car.chasing;
  let targetSpeed;
  let turnRate;
  if (chasing) {
    const p = state.player;
    car.turnTarget = car.angle + normAngle(Math.atan2(p.y - car.y, p.x - car.x) - car.angle);
    targetSpeed = POLICE.copCarSpeed;
    turnRate = 3.0;
  } else {
    updateRoadTarget(car, city, random);
    targetSpeed = car.cruise;
    // Slow right down for a turn: a tight turn stays on the road, a fast one
    // swings the nose into the building on the corner.
    if (Math.abs(normAngle(car.turnTarget - car.angle)) > 0.35) {
      targetSpeed = Math.min(targetSpeed, 55);
    }
    turnRate = 2.8;
  }
  targetSpeed = followTraffic(car, cars, dt, targetSpeed, !chasing);

  car.angle = turnToward(car.angle, car.turnTarget, turnRate * dt);
  const rate = chasing ? CAR.accel : CAR.accel * 0.5;
  if (car.speed < targetSpeed) car.speed = Math.min(targetSpeed, car.speed + rate * dt);
  else car.speed = Math.max(targetSpeed, car.speed - CAR.brake * 0.5 * dt);
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

/**
 * Ease off for the nearest same-direction car ahead in our lane, and pass a
 * stopped or crawling one on the left when no traffic is coming. Oncoming cars
 * are never followed: they drive the other lane, and following them is what
 * used to freeze whole roads head-on.
 */
function followTraffic(car, cars, dt, targetSpeed, allowPass) {
  let blocker = null;
  let blockerLon = Infinity;
  for (let j = 0; j < cars.length; j += 1) {
    const other = cars[j];
    if (other === car || !other.active) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const lon = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    if (lon <= 0 || lon > 110) continue;
    if (Math.cos(other.angle - car.angle) < 0.5) continue;
    const lat = -dx * Math.sin(car.angle) + dy * Math.cos(car.angle);
    if (Math.abs(lat - car.laneOff) > 30) continue;
    if (lon < blockerLon) {
      blockerLon = lon;
      blocker = other;
    }
  }

  if (allowPass && blocker && blocker.speed < 30 && car.passTimer <= 0) {
    if (!oncomingNear(car, cars, 220)) car.passTimer = 3.0;
  }
  if (car.passTimer > 0) {
    if (oncomingNear(car, cars, 130)) {
      car.passTimer = 0;
    } else if (blocker && blockerLon < -40) {
      car.passTimer = 0;
    } else {
      targetSpeed = Math.min(targetSpeed, 130);
    }
  }
  // Ease the lane offset toward the passing lane, or back to the right lane.
  const laneTarget = car.passTimer > 0 ? -LANE : LANE;
  car.laneOff += clamp(laneTarget - car.laneOff, -90 * dt, 90 * dt);

  if (blocker) {
    if (car.passTimer > 0) {
      // Passing it: don't brake for the car we are going around.
    } else if (blocker.speed < 25) {
      targetSpeed = Math.min(targetSpeed, blockerLon < 48 ? 0 : 40);
    } else if (blockerLon < 55) {
      targetSpeed = Math.min(targetSpeed, blocker.speed * 0.85);
    } else {
      targetSpeed = Math.min(targetSpeed, blocker.speed + 10);
    }
  }
  return targetSpeed;
}

/** True when oncoming traffic is within `range` ahead (head-on in our path). */
function oncomingNear(car, cars, range) {
  for (let j = 0; j < cars.length; j += 1) {
    const other = cars[j];
    if (other === car || !other.active) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const lon = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    if (lon < -40 || lon > range) continue;
    if (Math.cos(other.angle - car.angle) > -0.5) continue;
    return true;
  }
  return false;
}

/**
 * Pick the AI car's desired heading. The car follows its stored road axis
 * (car.axis, a cardinal heading) in the right-hand lane; at an intersection it
 * usually goes straight and sometimes turns onto the crossing road; off the
 * road it steers back toward the nearest road point.
 */
function updateRoadTarget(car, city, random) {
  // Re-sync a knocked-off axis (after a chase, a shove) once the car is
  // steering straight again; never mid-turn, or the turn would be undone.
  if (Math.abs(normAngle(car.turnTarget - car.angle)) < 0.3 && Math.abs(normAngle(car.axis - car.angle)) > 1.0) {
    car.axis = snapCardinal(car.angle);
  }

  // World edge: a car heading off the map turns inward onto the edge road.
  const EDGE = 40;
  if (car.y <= EDGE && Math.sin(car.axis) < -0.3) car.axis = car.x < WORLD.width / 2 ? 0 : Math.PI;
  else if (car.y >= WORLD.height - EDGE && Math.sin(car.axis) > 0.3) car.axis = car.x < WORLD.width / 2 ? 0 : Math.PI;
  else if (car.x <= EDGE && Math.cos(car.axis) < -0.3) car.axis = car.y < WORLD.height / 2 ? Math.PI / 2 : -Math.PI / 2;
  else if (car.x >= WORLD.width - EDGE && Math.cos(car.axis) > 0.3) car.axis = car.y < WORLD.height / 2 ? Math.PI / 2 : -Math.PI / 2;

  // Distance to the nearest road centreline (centres at 200 + 400k).
  const rx = mod(car.x - 200, ROAD.gap);
  const ry = mod(car.y - 200, ROAD.gap);
  const dx = Math.min(rx, ROAD.gap - rx);
  const dy = Math.min(ry, ROAD.gap - ry);
  const onV = dx < ROAD.width * 0.75;
  const onH = dy < ROAD.width * 0.75;
  if (!onV && !onH) {
    // Off the road entirely: steer back toward the nearest road point.
    if (city && typeof city.nearestRoadPoint === 'function') {
      const pt = city.nearestRoadPoint(car.x, car.y);
      if (pt) {
        car.turnTarget = car.angle + normAngle(Math.atan2(pt.y - car.y, pt.x - car.x) - car.angle);
        return;
      }
    }
    car.turnTarget = car.axis;
    return;
  }
  // A single road under the car fixes the axis: a vertical road is driven
  // north/south, a horizontal one east/west.
  if (onV && !onH && Math.abs(Math.cos(car.axis)) > 0.5) {
    car.axis = Math.sin(car.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  if (onH && !onV && Math.abs(Math.sin(car.axis)) > 0.5) {
    car.axis = Math.cos(car.angle) >= 0 ? 0 : Math.PI;
  }
  if (onV && onH && car.turnCooldown <= 0) {
    // Intersection: usually straight on, sometimes turn. The cooldown outlasts
    // a slow turn through the junction, so one crossing means one decision.
    car.turnCooldown = 3 + random() * 2;
    const roll = random();
    if (roll >= 0.62 && roll < 0.81) car.axis = normAngle(car.axis + Math.PI / 2);
    else if (roll >= 0.81) car.axis = normAngle(car.axis - Math.PI / 2);
  }
  // Steer along the axis, pulled toward the lane (right-hand traffic).
  car.turnTarget = laneHeading(car);
}

/**
 * The heading that keeps the car on its lane: the axis direction blended with
 * a correction toward the lane's centre line (the road centre shifted right of
 * the axis by laneOff). The blend is gentle, so the car converges smoothly.
 */
function laneHeading(car) {
  const ax = Math.cos(car.axis);
  const ay = Math.sin(car.axis);
  const rx = -Math.sin(car.axis);
  const ry = Math.cos(car.axis);
  // The effective road centre is kept inside the world: on a boundary road
  // (centreline on the map edge) the outer lane would otherwise fall outside
  // the map, collapsing both directions into one lane head-on.
  const EDGE = LANE + 6;
  let cx;
  let cy;
  if (Math.abs(ax) > Math.abs(ay)) {
    cx = car.x;
    const centre = clamp(200 + ROAD.gap * Math.round((car.y - 200) / ROAD.gap), EDGE, WORLD.height - EDGE);
    cy = centre + ry * car.laneOff;
  } else {
    const centre = clamp(200 + ROAD.gap * Math.round((car.x - 200) / ROAD.gap), EDGE, WORLD.width - EDGE);
    cx = centre + rx * car.laneOff;
    cy = car.y;
  }
  return Math.atan2(ay + (cy - car.y) * 0.015, ax + (cx - car.x) * 0.015);
}

/** The nearest cardinal heading to `angle`. */
function snapCardinal(angle) {
  return Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
}

/** An empty car (player just left it): rolls to a stop, steers nowhere. */
function stepDriverlessCar(car, dt) {
  car.speed -= car.speed * 2.2 * dt;
  if (car.speed > -2 && car.speed < 2) car.speed = 0;
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

/**
 * Penetration depth of two cars along axis (ax, ay), or <= 0 when separated.
 * Each car's radius on the axis is its half-length along its heading plus its
 * half-width across it, shrunk 15% so bumpers may kiss without a crash.
 */
function axisPen(ax, ay, dx, dy, ca, sa, cb, sb) {
  const ra = (CAR.length / 2) * Math.abs(ax * ca + ay * sa) + (CAR.width / 2) * Math.abs(ax * -sa + ay * ca);
  const rb = (CAR.length / 2) * Math.abs(ax * cb + ay * sb) + (CAR.width / 2) * Math.abs(ax * -sb + ay * cb);
  return (ra + rb) * 0.85 - Math.abs(dx * ax + dy * ay);
}

/**
 * Car against car: push the pair apart and, when they were closing fast, dent
 * both. Returns EVENT_HIT when at least one hard impact happened. The overlap
 * test is the separating-axis test for two oriented rectangles (length along
 * the heading, width across it), so two cars passing in opposite lanes — 36
 * units apart sideways — do not count as touching, while a rear-end, a
 * T-bone or a crossing still does. `immovable` (the car currently being
 * stolen) is never shoved: the other car takes the whole push instead.
 */
function collideCars(cars, immovable) {
  let events = 0;
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (!a.active) continue;
    const ca = Math.cos(a.angle);
    const sa = Math.sin(a.angle);
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      if (!b.active) continue;
      const cb = Math.cos(b.angle);
      const sb = Math.sin(b.angle);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // The four separating axes (both headings, both laterals), unrolled so
      // the hot loop allocates nothing; keep the shallowest penetration.
      let minPen = Infinity;
      let sepX = 1;
      let sepY = 0;
      let separated = false;
      for (let k = 0; k < 4; k += 1) {
        let ax;
        let ay;
        if (k === 0) { ax = ca; ay = sa; }
        else if (k === 1) { ax = -sa; ay = ca; }
        else if (k === 2) { ax = cb; ay = sb; }
        else { ax = -sb; ay = cb; }
        const pen = axisPen(ax, ay, dx, dy, ca, sa, cb, sb);
        if (pen <= 0) {
          separated = true;
          break;
        }
        if (pen < minPen) {
          minPen = pen;
          const s = dx * ax + dy * ay >= 0 ? 1 : -1;
          sepX = ax * s;
          sepY = ay * s;
        }
      }
      if (separated) continue;
      // Push apart along the shallowest axis; a car being stolen does not move.
      const pushA = a === immovable ? 0 : b === immovable ? minPen : minPen * 0.5;
      const pushB = b === immovable ? 0 : a === immovable ? minPen : minPen * 0.5;
      a.x -= sepX * pushA;
      a.y -= sepY * pushA;
      b.x += sepX * pushB;
      b.y += sepY * pushB;
      const closing = Math.abs((a.vx - b.vx) * sepX + (a.vy - b.vy) * sepY);
      if (closing > 60) {
        const damage = Math.min(25, closing * 0.03);
        for (const car of [a, b]) {
          // Dent and slow on impact only (once per cooldown per car): a
          // pile-up must not melt a car, and a shove must not drain its
          // speed away frame after frame while the cars stay in contact.
          if (car.crashCooldown <= 0) {
            car.health -= damage;
            car.crashCooldown = 0.5;
            car.speed *= 0.7;
            car.vx *= 0.7;
            car.vy *= 0.7;
          }
          if (car.health <= 0) {
            car.health = 0;
            car.smoking = true;
            car.speed = 0;
            car.vx = 0;
            car.vy = 0;
          }
        }
        events |= EVENT_HIT;
      }
    }
  }
  return events;
}

/**
 * The player's moving car touching a pedestrian: flag only. traffic.js puts
 * the pedestrian down and adds the heat, so nothing is double-counted.
 */
function checkPedHits(state) {
  const p = state.player;
  if (p.onFoot || !p.car || !p.car.active || Math.abs(p.car.speed) <= 30) return 0;
  const car = p.car;
  for (let i = 0; i < state.peds.length; i += 1) {
    const ped = state.peds[i];
    if (!ped.active || ped.state === 'down') continue;
    const dx = ped.x - car.x;
    const dy = ped.y - car.y;
    if (dx * dx + dy * dy < CAR.width * CAR.width) return EVENT_HIT;
  }
  return 0;
}
