// The screenshot scenes behind ?shot=cover|street|mission|chase. Each one plays
// the real rules forward from a fresh world for a fixed number of steps,
// steered by a simple autopilot (Manhattan routing along the road grid toward
// the mission target), so the frame is what a short game really looks like and
// the same seed always gives the same frame. The staging may move the world
// state directly — position the player, set the heat, start a mission — then
// the simulation takes over from there.
import { CAR, PALETTE, POLICE, STEP } from './config.js';
import { beginStage, startMission } from './missions.js';
import { spawnCivilCar } from './vehicles.js';
import { SCREEN_PLAY } from './render.js';

/** Road centrelines: vertical roads run the full height, horizontal ones the top five rows. */
const VERTICAL = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
const HORIZONTAL = [200, 600, 1000, 1400, 1800];

function blankInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    run: false,
    handbrake: false,
    actionPressed: false,
    punchPressed: false,
    confirmPressed: false,
    pausePressed: false,
    mutePressed: false,
  };
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** The road centreline nearest to `value`. */
function nearestCenter(value, centers) {
  let best = centers[0];
  let bestDist = Infinity;
  for (let i = 0; i < centers.length; i += 1) {
    const d = Math.abs(value - centers[i]);
    if (d < bestDist) {
      bestDist = d;
      best = centers[i];
    }
  }
  return best;
}

/**
 * The next waypoint on a Manhattan route from (x, y) to (tx, ty): along the
 * current road to the intersection with the target's cross road, then along
 * that road, then down the target's road. Off the road, the nearest
 * intersection comes first.
 */
function nextWaypoint(x, y, tx, ty) {
  const vx = nearestCenter(x, VERTICAL);
  const hy = nearestCenter(y, HORIZONTAL);
  const onV = Math.abs(x - vx) <= 40;
  const onH = Math.abs(y - hy) <= 40;
  if (!onV && !onH) return { x: vx, y: hy };
  const tvx = nearestCenter(tx, VERTICAL);
  const thy = nearestCenter(ty, HORIZONTAL);
  if (onV && !onH) {
    if (vx === tvx) return { x: vx, y: Math.max(0, Math.min(2160, ty)) };
    return { x: vx, y: thy };
  }
  if (onH && !onV) {
    if (hy === thy) return { x: Math.max(0, Math.min(2960, tx)), y: hy };
    return { x: tvx, y: hy };
  }
  // At an intersection: along the road that still has the longer way to go.
  if (vx === tvx) return { x: vx, y: Math.max(0, Math.min(2160, ty)) };
  if (hy === thy) return { x: Math.max(0, Math.min(2960, tx)), y: hy };
  if (Math.abs(ty - y) >= Math.abs(tx - x)) return { x: vx, y: thy };
  return { x: tvx, y: hy };
}

/** Put the player behind the wheel of a fresh car at (x, y), facing `angle`. */
function putPlayerInCar(world, x, y, angle) {
  const { state, city, random } = world;
  const car = spawnCivilCar(state, city, random, x, y);
  if (!car) return null;
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.turnTarget = angle;
  car.axis = angle;
  car.laneOff = 18;
  car.speed = 0;
  car.vx = 0;
  car.vy = 0;
  car.driver = 'player';
  car.kind = 'player';
  // The player's own car stands out: Solara red, never a traffic colour.
  car.color = PALETTE.player;
  const p = state.player;
  p.onFoot = false;
  p.car = car;
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.speed = 0;
  return car;
}

/** Fill a free car slot with a police chase car at (x, y), facing `angle`. */
function placePoliceCar(world, x, y, angle) {
  const { state } = world;
  let car = null;
  for (let i = 0; i < state.cars.length; i += 1) {
    if (!state.cars[i].active) {
      car = state.cars[i];
      break;
    }
  }
  if (!car) return null;
  car.active = true;
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.turnTarget = angle;
  car.axis = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  car.laneOff = 18;
  car.passTimer = 0;
  car.turnCooldown = 0;
  car.ramCooldown = 0;
  car.chasing = true;
  car.cruise = POLICE.copCarSpeed;
  car.speed = POLICE.copCarSpeed * 0.6;
  car.vx = Math.cos(angle) * car.speed;
  car.vy = Math.sin(angle) * car.speed;
  car.color = PALETTE.police;
  car.model = 'police';
  car.kind = 'police';
  car.driver = 'ai';
  car.health = CAR.health;
  car.smoking = false;
  car.mission = false;
  return car;
}

/** Drive toward (tx, ty): gas, steer at the waypoint, brake for sharp turns. */
function driveInput(world, tx, ty) {
  const p = world.state.player;
  const wp = nextWaypoint(p.x, p.y, tx, ty);
  const want = Math.atan2(wp.y - p.y, wp.x - p.x);
  const diff = normAngle(want - p.angle);
  const input = blankInput();
  if (p.speed < -20) {
    // Spun around and rolling backward: stop the reverse and get moving
    // forward again instead of braking deeper into it. No steering while
    // the car is still rolling backward — the physics inverts it there,
    // so steering now would swing the nose the wrong way.
    input.up = true;
    return input;
  }
  if (diff > 0.15) input.right = true;
  else if (diff < -0.15) input.left = true;
  // Cruise near 220 (the cops are faster anyway). No braking for the car
  // ahead: stopping behind traffic lets the police pile into the queue and
  // wedge everything onto the block; ploughing through at city speed is
  // what the shot needs, and the bumps at this speed are survivable.
  const speed = Math.abs(p.speed);
  if ((Math.abs(diff) > 0.9 && speed > 140)) {
    input.down = true;
  } else if (speed > 220) {
    // Coast: no gas, no brake — let the speed settle.
  } else if (Math.abs(speed) < 25 && Math.abs(diff) > 1.2) {
    // Stuck nose-in: reverse out while steering at the waypoint.
    input.down = true;
  } else {
    input.up = true;
  }
  return input;
}

/** Walk toward (tx, ty) along the roads: the on-foot version of driveInput. */
function walkInput(world, tx, ty) {
  const p = world.state.player;
  const wp = nextWaypoint(p.x, p.y, tx, ty);
  const input = blankInput();
  const dx = wp.x - p.x;
  const dy = wp.y - p.y;
  if (dy < -24) input.up = true;
  else if (dy > 24) input.down = true;
  if (dx < -24) input.left = true;
  else if (dx > 24) input.right = true;
  return input;
}

/** Run the simulation forward `seconds` with the autopilot steering each step. */
function runSim(world, seconds, pilot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) world.step(STEP, pilot(world));
}

/**
 * Set `world` to the named scene (cover, street, mission or chase; any other
 * name is cover) and return the screen to draw over it and the best cash.
 */
export function stageShot(name, world) {
  const { state, missionCity } = world;
  world.reset();

  if (name === 'street') {
    // On foot in Downtown, pedestrians everywhere, M1 briefed and running.
    startMission(state, missionCity, 0);
    beginStage(state, missionCity);
    state.storyLog = state.storyLog.slice(-1);
    state.player.x = 1400;
    state.player.y = 1040;
    state.player.angle = 0;
    runSim(world, 4, (w) => walkInput(w, 2880, 2000));
  } else if (name === 'mission') {
    // M4 Harbor Run mid-run: timed checkpoints, player driving to Harbor.
    startMission(state, missionCity, 3);
    beginStage(state, missionCity);
    state.storyLog = state.storyLog.slice(-1);
    putPlayerInCar(world, 1800, 1400, 0);
    runSim(world, 3.5, (w) => driveInput(w, 2880, 1000));
  } else if (name === 'chase') {
    // Wanted 4, three police cars closing in from behind, player fleeing north.
    // Free roam (no mission marker): the frame is about the pursuit alone.
    state.mission.stage = 'complete';
    state.mission.objective = 'Free roam — Costa Solara is yours';
    state.mission.target = { x: 0, y: 0, label: 'Free roam' };
    state.storyLog = [];
    state.heat = 95;
    // Close behind on the same road (150-450 back): the camera centres the
    // player, so cops any further back fall off the bottom of the frame.
    // A 2-second run keeps their rams survivable.
    putPlayerInCar(world, 1000, 1200, -Math.PI / 2);
    // On the same road, directly behind: a chasing cop steers straight at the
    // player, so off-road starting spots would send it through the buildings.
    // All four placed, so stepPolice spawns no extra cop across the blocks.
    placePoliceCar(world, 1000, 1350, -Math.PI / 2);
    placePoliceCar(world, 1000, 1450, -Math.PI / 2);
    placePoliceCar(world, 1000, 1550, -Math.PI / 2);
    placePoliceCar(world, 1000, 1650, -Math.PI / 2);
    runSim(world, 2, (w) => driveInput(w, 1600, 120));
  } else {
    // Cover: wanted 3, two police cars on the tail, M6's Lighthouse drop ahead
    // — chase, minimap, HUD and mission objective in one frame.
    startMission(state, missionCity, 5);
    beginStage(state, missionCity);
    // Jump the Big Score to its Lighthouse drop, so the marker leads the chase.
    state.mission.progress = 2;
    state.mission.objective = 'Drop 3: Lighthouse';
    state.mission.target = { x: 3050, y: 400, label: 'Drop 3: Lighthouse' };
    state.storyLog = state.storyLog.slice(-1);
    // Ploughing through the intersection picks up heat (pedestrians in the
    // way), so start cooler: the frame should show three stars, not four.
    state.heat = 55;
    // Short and close: the player starts near the Lighthouse with the cops
    // 300 behind on the same road, so the frame holds the chase, the tower
    // and its gold ring — before the rams have time to spin the car around.
    putPlayerInCar(world, 2600, 800, -Math.PI / 2);
    // All three chase cars placed on the same road behind the player: a
    // spawned cop would steer straight at the player across the blocks and
    // plough through the traffic to get there.
    placePoliceCar(world, 2600, 1100, -Math.PI / 2);
    placePoliceCar(world, 2600, 1200, -Math.PI / 2);
    placePoliceCar(world, 2600, 1300, -Math.PI / 2);
    runSim(world, 2, (w) => driveInput(w, 3050, 400));
  }

  return { screen: SCREEN_PLAY, best: 0 };
}
