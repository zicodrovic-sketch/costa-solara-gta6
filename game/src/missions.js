// Costa Solara — missions & story: Mara Voss, new courier for the "Solara Swift" crew.
// Boss: Dario. Six missions in order; each one is a list of stages (landmark stops).
// stepMissions() returns an EVENT_* bitmask; it never writes state.events itself.
// Arrival = player within 60 units of the stage target. A blown timer restarts the
// same mission from its brief (never a game over).
import { EVENT_MISSION_DONE, EVENT_PICKUP, MONEY, PALETTE, POLICE, WORLD } from './config.js';

/** How close the player must be to a stage target for it to count as reached. */
const ARRIVE_DIST = 60;

/** Six missions, in order. reward/timeLimit come from MONEY in config.js. */
export const MISSION_LIST = [
  {
    id: 'M1',
    title: 'First Delivery',
    brief: 'First day on the job. Dario hands Mara a parcel and a borrowed hatchback.',
    intro: 'Dario: First delivery, Mara. Marina, quick and clean. No detours.',
    reward: MONEY.missionReward[0],
    timeLimit: 100,
    stages: [{ landmark: 'Marina', label: 'Deliver the package to the Marina' }],
  },
  {
    id: 'M2',
    title: 'Taxi Trouble',
    brief: 'The crew cab is short a driver. Three fares, three stops, one very impatient city.',
    intro: 'Dario: Cab\'s yours today. Pick up at the Market, then Old Town, then Beachfront.',
    reward: MONEY.missionReward[1],
    timeLimit: 150,
    stages: [
      { landmark: 'Market', label: 'Pick up fare 1 at the Market' },
      { landmark: 'Old Town', label: 'Pick up fare 2 in Old Town' },
      { landmark: 'Beachfront', label: 'Drop the last fare at Beachfront' },
    ],
  },
  {
    id: 'M3',
    title: 'The Getaway',
    brief: 'A drop goes wrong and the whole force is on Mara. Lose them, then vanish.',
    intro: 'Dario: Drop went bad, Mara. Cops everywhere. Lose them, then get to the Garage.',
    reward: MONEY.missionReward[2],
    timeLimit: 0,
    stages: [
      { landmark: null, label: 'Lose the cops — get your wanted level to 0' },
      { landmark: 'Garage', label: 'Lay low at the Garage' },
    ],
  },
  {
    id: 'M4',
    title: 'Harbor Run',
    brief: 'A timed run through the checkpoints. The crew is watching the clock.',
    intro: 'Dario: Harbor, Lighthouse, North Gate — two minutes. Don\'t make me wait.',
    reward: MONEY.missionReward[3],
    timeLimit: 120,
    stages: [
      { landmark: 'Harbor', label: 'Checkpoint 1: Harbor' },
      { landmark: 'Lighthouse', label: 'Checkpoint 2: Lighthouse' },
      { landmark: 'North Gate', label: 'Checkpoint 3: North Gate' },
    ],
  },
  {
    id: 'M5',
    title: 'Repo Run',
    brief: 'A gold coupe parked by the Market belongs to the crew now. Take it home.',
    intro: 'Dario: Gold coupe by the Market. It\'s ours — bring it to the Garage.',
    reward: MONEY.missionReward[4],
    timeLimit: 0,
    stages: [
      { landmark: null, label: 'Find the gold coupe near the Market' },
      { landmark: 'Garage', label: 'Deliver the coupe to the Garage' },
    ],
  },
  {
    id: 'M6',
    title: 'The Big Score',
    brief: 'Three drops across the city with the whole force already hunting. The big one.',
    intro: 'Dario: The big score, Mara. Three drops, cops on us from the start. Make it count.',
    reward: MONEY.missionReward[5],
    timeLimit: 0,
    stages: [
      { landmark: 'Marina', label: 'Drop 1: Marina' },
      { landmark: 'Harbor', label: 'Drop 2: Harbor' },
      { landmark: 'Lighthouse', label: 'Drop 3: Lighthouse' },
      { landmark: 'Lighthouse', label: 'Final drop — Lighthouse' },
    ],
  },
];

/** Fresh mission state: the first mission waits at its brief until the player confirms. */
export function createMissions() {
  return {
    index: 0,
    stage: 'brief',
    title: MISSION_LIST[0].title,
    objective: MISSION_LIST[0].stages[0].label,
    target: { x: 0, y: 0, label: MISSION_LIST[0].stages[0].label },
    timer: 0,
    progress: 0,
    targetCar: null,
  };
}

/** Look a landmark up in the city; fall back to the map centre if the city lacks it. */
function landmarkPos(city, name) {
  const spot = city && city.landmarks && city.landmarks[name];
  if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) return { x: spot.x, y: spot.y };
  return { x: WORLD.width / 2, y: WORLD.height / 2 };
}

/** Append a story line, keeping only the last four. */
function pushStory(state, line) {
  if (!Array.isArray(state.storyLog)) state.storyLog = [];
  state.storyLog.push(line);
  while (state.storyLog.length > 4) state.storyLog.shift();
}

/** Point the mission at one stage: target coords + objective text from the landmark. */
function setStageTarget(state, city, mission, stageIndex) {
  const stage = mission.stages[stageIndex];
  state.mission.progress = stageIndex;
  state.mission.objective = stage.label;
  if (stage.landmark) {
    const pos = landmarkPos(city, stage.landmark);
    state.mission.target = { x: pos.x, y: pos.y, label: stage.label };
  } else {
    state.mission.target = { x: 0, y: 0, label: stage.label };
  }
}

/**
 * Set up mission `index` on the state: title, brief stage, timer and first target.
 * Mission-specific setup lives here: M3 starts hot (heat 45, wanted 2), M6 starts
 * hotter (heat 60, wanted 3), M5 marks the gold coupe to steal.
 */
export function startMission(state, city, index) {
  const mission = MISSION_LIST[index];
  if (!mission) return;
  state.mission.index = index;
  state.mission.stage = 'brief';
  state.mission.title = mission.title;
  state.mission.timer = mission.timeLimit;
  state.mission.progress = 0;
  state.mission.targetCar = null;
  if (index === 2) {
    state.heat = 45;
    state.wanted = 2;
  } else if (index === 5) {
    state.heat = POLICE.heatPerStar * 3;
    state.wanted = 3;
  }
  if (index === 4) markRepoCar(state, city);
  setStageTarget(state, city, mission, 0);
  pushStory(state, mission.intro);
}

/**
 * Move a briefed mission to 'active' (called when the player confirms the brief).
 * Re-applies the first stage target so a mission resumed from a save points right.
 */
export function beginStage(state, city) {
  if (state.mission.stage !== 'brief') return;
  const mission = MISSION_LIST[state.mission.index];
  if (!mission) return;
  state.mission.stage = 'active';
  state.mission.timer = mission.timeLimit;
  setStageTarget(state, city, mission, state.mission.progress);
}

/**
 * M5 setup: the civilian car nearest the Market becomes the gold coupe to steal.
 * Marks it (car.mission = true) and remembers it on state.mission.targetCar.
 */
function markRepoCar(state, city) {
  if (!Array.isArray(state.cars)) return;
  const market = landmarkPos(city, 'Market');
  let best = null;
  let bestDist = Infinity;
  for (const car of state.cars) {
    if (!car || !car.active || car.mission) continue;
    if (car.kind === 'cop' || car.kind === 'police') continue;
    const dx = car.x - market.x;
    const dy = car.y - market.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  }
  if (!best) return;
  best.mission = true;
  best.model = 'coupe';
  best.color = PALETTE.gold;
  state.mission.targetCar = best;
}

/** Distance from the player to a point. */
function distToPlayer(state, x, y) {
  const dx = state.player.x - x;
  const dy = state.player.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Finish the current mission: pay out, log it, and brief the next one (or free roam). */
function completeMission(state, city) {
  const mission = MISSION_LIST[state.mission.index];
  state.cash += mission.reward;
  pushStory(state, `Dario: Nice work, Mara. $${mission.reward} — that's the ${mission.title} job done.`);
  if (state.mission.index + 1 >= MISSION_LIST.length) {
    state.mission.stage = 'complete';
    state.mission.objective = 'Free roam — Costa Solara is yours';
    state.mission.target = { x: 0, y: 0, label: 'Free roam' };
    state.mission.timer = 0;
    state.mission.targetCar = null;
    pushStory(state, 'Dario: That\'s the whole crew\'s trust, Mara. Costa Solara is yours now.');
    return EVENT_MISSION_DONE;
  }
  startMission(state, city, state.mission.index + 1);
  return EVENT_MISSION_DONE;
}

/** Advance one stage: log it, point at the next target, or complete the mission. */
function advanceStage(state, city) {
  const mission = MISSION_LIST[state.mission.index];
  const next = state.mission.progress + 1;
  if (next >= mission.stages.length) return completeMission(state, city);
  setStageTarget(state, city, mission, next);
  pushStory(state, `Dario: Good. Next stop — ${mission.stages[next].label}.`);
  return EVENT_PICKUP;
}

/**
 * One fixed step of mission logic. Handles the timer, the M3 lose-the-cops stage,
 * the M5 moving car target, and arrival checks for every other stage.
 */
export function stepMissions(state, dt, city) {
  if (!state.mission || state.mission.stage !== 'active') return 0;
  const mission = MISSION_LIST[state.mission.index];
  if (!mission) return 0;
  let events = 0;

  // Timed missions: the clock runs out, the job restarts from its brief.
  if (state.mission.timer > 0) {
    state.mission.timer -= dt;
    if (state.mission.timer <= 0) {
      pushStory(state, "Dario: Time's up — run it again, Mara. Same job, fresh clock.");
      startMission(state, city, state.mission.index);
      return 0;
    }
  }

  // M3, stage 0: the job is done only once the wanted level is fully gone.
  if (state.mission.index === 2 && state.mission.progress === 0) {
    if (state.wanted === 0) {
      setStageTarget(state, city, mission, 1);
      pushStory(state, 'Dario: Clean. Now slip to the Garage before they pick up the trail.');
      return EVENT_PICKUP;
    }
    return 0;
  }

  // M5, stage 0: the target is a car, so it moves — chase the car, not a fixed point.
  if (state.mission.index === 4 && state.mission.progress === 0) {
    const car = state.mission.targetCar;
    if (!car || !car.active) return 0;
    state.mission.target = { x: car.x, y: car.y, label: 'Steal the gold coupe' };
    if (distToPlayer(state, car.x, car.y) < ARRIVE_DIST) {
      pushStory(state, 'Dario: That\'s the coupe. Get it to the Garage, Mara.');
      return advanceStage(state, city);
    }
    return 0;
  }

  // Every other stage: arrive at the fixed landmark target.
  if (distToPlayer(state, state.mission.target.x, state.mission.target.y) < ARRIVE_DIST) {
    events |= advanceStage(state, city);
  }
  return events;
}
