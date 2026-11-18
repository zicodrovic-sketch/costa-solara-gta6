// Costa Solara — the world: one state object, one fixed step, no drawing and
// no browser in it. It wires the finished modules together in the order the
// simulation needs: the player first (it stashes the frame's input for the
// cars), then cars, traffic, pedestrians, police and missions. step() returns
// the frame's EVENT_* flags and also OR-s them into state.events, so the
// caller can turn them into sound and the renderer into effects.
// Busted, wrecked and wasted are settled here, never inside a sub-module.
//
// One integration note: city.js stores landmarks as a list
// ([{name, x, y}, ...]) while missions.js looks them up as a map
// (landmarks[name]); the world hands missions a shallow copy of the city
// with the landmarks re-indexed by name, so neither finished file changes.

import { EVENT_BUSTED, EVENT_MISSION_DONE, MONEY, PLAYER, WORLD } from './config.js';
import { createCity, collidesBuilding } from './city.js';
import { createPlayer, stepPlayer } from './player.js';
import { createCars, stepCars } from './vehicles.js';
import { createTraffic, stepPedestrians, stepTraffic } from './traffic.js';
import { createCops, stepPolice } from './police.js';
import { beginStage, createMissions, startMission, stepMissions } from './missions.js';
import { saveGame } from './save.js';

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** The city's landmarks re-indexed by name, for the missions module. */
function landmarkMap(city) {
  const map = {};
  const list = city.landmarks || [];
  for (let i = 0; i < list.length; i += 1) {
    const lm = list[i];
    if (lm && lm.name) map[lm.name] = { x: lm.x, y: lm.y };
  }
  return map;
}

/** The Garage landmark's {x, y}, from the city's list; map centre as a fallback. */
function garagePoint(city) {
  const list = city.landmarks || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].name === 'Garage') return { x: list[i].x, y: list[i].y };
  }
  return { x: WORLD.width / 2, y: WORLD.height / 2 };
}

/** Put the player on foot beside their car and leave the car as an empty civil car. */
function forceExitCar(state, city) {
  const p = state.player;
  const car = p.car;
  p.car = null;
  p.onFoot = true;
  p.speed = 0;
  p.stealing = 0;
  p.stealTarget = null;
  if (!car) return;
  car.driver = 'none';
  car.kind = 'civil';
  const px = Math.cos(car.angle + Math.PI / 2);
  const py = Math.sin(car.angle + Math.PI / 2);
  for (let s = 1; s >= -1; s -= 2) {
    const nx = clamp(car.x + px * 44 * s, PLAYER.radius, WORLD.width - PLAYER.radius);
    const ny = clamp(car.y + py * 44 * s, PLAYER.radius, WORLD.height - PLAYER.radius);
    if (collidesBuilding(city, nx, ny)) continue;
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

export function createWorld(random, saveData) {
  const save = saveData || { cash: 0, missionIndex: 0, bestCash: 0, muted: false };
  const city = createCity(random);
  const missionCity = { ...city, landmarks: landmarkMap(city) };
  const state = {
    time: 0,
    cash: save.cash || 0,
    wanted: 0,
    heat: 0,
    muted: !!save.muted,
    player: null,
    cars: createCars(),
    peds: createTraffic(),
    cops: createCops(),
    mission: createMissions(),
    storyLog: [],
    banner: { text: '', t: 0 },
    events: 0,
    gameOver: null,
    input: null,
  };
  state.player = createPlayer(city);

  // What a reset returns to: the last saved run (cash and mission advance only
  // when a mission completes and saveGame runs).
  let savedCash = state.cash;
  let savedMissionIndex = clamp(save.missionIndex || 0, 0, 5);

  function reset() {
    state.time = 0;
    state.cash = savedCash;
    state.wanted = 0;
    state.heat = 0;
    state.gameOver = null;
    state.events = 0;
    state.banner = { text: '', t: 0 };
    state.storyLog = [];
    state.input = null;
    for (let i = 0; i < state.cars.length; i += 1) state.cars[i].active = false;
    for (let i = 0; i < state.peds.length; i += 1) state.peds[i].active = false;
    for (let i = 0; i < state.cops.length; i += 1) state.cops[i].active = false;
    state.player = createPlayer(city);
    state.mission = createMissions();
    // Fill the streets first (a zero-length step only spawns, nothing moves),
    // so mission setup that needs a car on the road — the M5 repo coupe — finds one.
    stepTraffic(state, 0, city, random);
    stepPedestrians(state, 0, city, random);
    startMission(state, missionCity, savedMissionIndex);
  }

  /** Accept the briefed mission and start its clock (Enter or click during play). */
  function beginMission() {
    beginStage(state, missionCity);
  }

  /**
   * One fixed step. `input` is the frame's snapshot (held keys plus edge
   * flags); the caller passes the same snapshot to the first step of a frame
   * and a held-only copy to any further ones, so an edge fires once.
   * Returns the frame's EVENT_* bitmask.
   */
  function step(dt, input) {
    let events = 0;
    state.time += dt;
    if (state.banner.t > 0) state.banner.t = Math.max(0, state.banner.t - dt);

    // The order matters: the player stashes the input for the cars, and the
    // missions read the wanted level the police just settled.
    events |= stepPlayer(state, input, dt, city);
    events |= stepCars(state, dt, city, random);
    events |= stepTraffic(state, dt, city, random);
    events |= stepPedestrians(state, dt, city, random);
    events |= stepPolice(state, dt, city, random);
    events |= stepMissions(state, dt, missionCity);

    const p = state.player;

    // The player's car wrecked under them: hurt, thrown out on foot, banner.
    if (!p.onFoot && p.car && p.car.health <= 0) {
      p.health -= 25;
      forceExitCar(state, city);
      state.banner = { text: 'CAR WRECKED', t: 3 };
    }

    // Busted: fined, heat cleared, back on foot at the Garage, healthy again.
    if (events & EVENT_BUSTED) {
      state.cash = Math.max(0, state.cash - MONEY.bustFine);
      state.heat = 0;
      state.wanted = 0;
      if (!p.onFoot && p.car) {
        p.car.driver = 'none';
        p.car.kind = 'civil';
        p.car = null;
      }
      p.onFoot = true;
      const g = garagePoint(city);
      p.x = g.x;
      p.y = g.y;
      p.angle = -Math.PI / 2;
      p.speed = 0;
      p.health = PLAYER.health;
      p.stealing = 0;
      p.stealTarget = null;
      p.invulnerable = PLAYER.invulnerable;
      state.banner = { text: 'BUSTED — $' + MONEY.bustFine + ' fine', t: 3 };
    }

    // A finished mission pays out, saves, and briefs the next one.
    if (events & EVENT_MISSION_DONE) {
      saveGame(state);
      savedCash = state.cash;
      savedMissionIndex = state.mission.index;
      state.banner = { text: 'MISSION COMPLETE', t: 3 };
    }

    if (p.health <= 0) state.gameOver = 'wasted';

    state.events |= events;
    return events;
  }

  reset();
  return { state, city, missionCity, random, reset, step, beginMission };
}
