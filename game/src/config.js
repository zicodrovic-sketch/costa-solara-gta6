// Costa Solara — every tuning number, colour and shared constant in one place.
// The city is 3200x2400 world units; the camera shows a 1280x720 window of it. The
// simulation runs in fixed 1/60 s steps, so no rule below depends on the screen size.
// This file is the contract every other module imports: change a name here only together
// with every module that uses it.

export const WORLD = { width: 3200, height: 2400 };
export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** City grid: roads every 400 units, 72 wide; blocks between them hold buildings and parks. */
export const ROAD = { gap: 400, width: 72 };

export const PLAYER = {
  radius: 14,
  walkSpeed: 175,
  runSpeed: 265,
  health: 100,
  punchRange: 36,
  punchDamage: 34,
  punchCooldown: 0.45,
  punchTime: 0.22,
  invulnerable: 1.0,
  stealTime: 0.9,
};

/** Cars: length along their heading, width across it. Speeds are world units per second. */
export const CAR = {
  length: 56,
  width: 28,
  accel: 430,
  brake: 720,
  reverseAccel: 230,
  maxSpeed: 540,
  maxReverse: 170,
  turnRate: 2.7,
  /** How fast a moving car straightens toward its heading; higher grips harder. */
  grip: 6.0,
  health: 100,
  /** Damage a car takes per second of hard scraping; a wrecked car stops and smokes. */
  scrapeDamage: 9,
};

export const TRAFFIC = {
  cars: 14,
  cruiseSpeed: 150,
  cruiseJitter: 45,
  spawnAhead: 900,
  despawnBehind: 1200,
};

export const PEDESTRIANS = {
  count: 26,
  walkSpeed: 55,
  walkJitter: 25,
  fleeSpeed: 150,
};

/** Police: how the wanted level behaves and how the force answers it. */
export const POLICE = {
  maxStars: 5,
  /** Heat 0..100; each star needs 20 heat. Heat rises with crimes, falls when hidden. */
  heatPerStar: 20,
  heatStealCar: 22,
  heatPunch: 8,
  heatSpeeding: 0.6,
  heatPerSecondHidden: 6,
  heatPerSecondSeen: 1.5,
  chaseCarsPerStar: 1,
  maxChaseCars: 5,
  footCopsPerStar: 1,
  maxFootCops: 5,
  copCarSpeed: 560,
  copFootSpeed: 200,
  bustRange: 30,
  bustTime: 1.2,
  ramDamage: 12,
};

/** Pool sizes: every entity is allocated once at boot, never during play. */
export const POOLS = { cars: 26, peds: 30, cops: 8, particles: 160 };

/** Cash rewards and fines, in Solara dollars. */
export const MONEY = {
  missionReward: [250, 400, 600, 750, 900, 1500],
  bustFine: 200,
  pickupTip: 40,
};

/** Event flags: step() functions return them OR-ed together; main.js turns them into sound. */
export const EVENT_CASH = 1;
export const EVENT_WANTED_UP = 2;
export const EVENT_WANTED_DOWN = 4;
export const EVENT_MISSION_DONE = 8;
export const EVENT_BUSTED = 16;
export const EVENT_HIT = 32;
export const EVENT_STEAL = 64;
export const EVENT_PUNCH = 128;
export const EVENT_PICKUP = 256;
export const EVENT_ENGINE = 512;

/** Where the save lives (this browser only): money, mission progress and best run. */
export const SAVE_KEY = 'costa-solara.save.v1';

/** Sun-soaked coastal city: sand, sea, terracotta roofs, palm green, warm asphalt. */
export const PALETTE = {
  backdrop: '#101820',
  sea: '#1e7f8e',
  seaDeep: '#14606e',
  sand: '#e6cf9e',
  sandDark: '#d4b983',
  grass: '#7fae62',
  park: '#6f9e57',
  road: '#43403c',
  roadLine: '#e8dcc0',
  sidewalk: '#b8a888',
  building: '#c98d5f',
  buildingRoof: '#a85f3c',
  buildingGlass: '#7fc4d4',
  building2: '#d9b06a',
  building3: '#8fa8a0',
  marina: '#2a6f7e',
  player: '#ff5a4e',
  playerShirt: '#ffd23e',
  police: '#2b6fd6',
  policeLight: '#ff3b30',
  trafficCar: '#e8e4da',
  ped: '#f2e6c9',
  hud: '#101820',
  hudText: '#f5efdd',
  gold: '#f2c94c',
  text: '#f5efdd',
  muted: '#c9bd9f',
  panel: '#1d2733',
  danger: '#ff5a4e',
  ok: '#7fd67f',
  marker: '#ffd23e',
};

/** Landmark names missions and spawn points refer to; city.js places each one on the map. */
export const LANDMARKS = ['Marina', 'Old Town', 'Harbor', 'Lighthouse', 'Garage', 'Market', 'Beachfront', 'North Gate'];

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
