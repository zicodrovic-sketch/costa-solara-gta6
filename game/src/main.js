// Costa Solara — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. The game moves between four
// screens: title, play, paused and game over.
//
// ?seed=N fixes the city and the traffic. ?shot=cover|street|mission|chase
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
import {
  CAR,
  EVENT_BUSTED,
  EVENT_CASH,
  EVENT_HIT,
  EVENT_MISSION_DONE,
  EVENT_PICKUP,
  EVENT_PUNCH,
  EVENT_STEAL,
  EVENT_WANTED_UP,
  STEP,
} from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';
import { createAudio } from './audio.js';
import { loadSave, saveGame } from './save.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

/** No keys held, no edges: the title screen's attract mode and a fresh frame's base. */
const BLANK_INPUT = {
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

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const save = loadSave();
const world = createWorld(createRandom(seed), save);
const renderer = createRenderer(canvas, world.city);
const audio = createAudio();
audio.setMuted(save.muted);

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = save.bestCash || 0;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes and the big moments.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. First job: ' + world.state.mission.title + '.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.cash > best) best = world.state.cash;
    saveGame(world.state);
    announce('Wasted. Cash $' + Math.floor(world.state.cash) + '. Best $' + Math.floor(best) + '.');
  }

  /** Turn the frame's event flags into sound. */
  function playSounds(events) {
    if (events & EVENT_MISSION_DONE) audio.jingle();
    if (events & EVENT_CASH) audio.cash();
    if (events & EVENT_PICKUP) audio.blip();
    if (events & EVENT_HIT) audio.crash();
    if (events & EVENT_PUNCH) audio.thud();
    if (events & EVENT_STEAL) audio.blip();
    if (events & EVENT_WANTED_UP) audio.blip();
    if (events & EVENT_BUSTED) audio.crash();
  }

  function handleScreenInput(snapshot) {
    if (snapshot.mutePressed) {
      world.state.muted = !world.state.muted;
      audio.setMuted(world.state.muted);
      saveGame(world.state);
    }
    if (snapshot.confirmPressed) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) {
        startGame();
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      } else if (screen === SCREEN_PLAY && world.state.mission.stage === 'brief') {
        world.beginMission();
        audio.blip();
        announce(world.state.mission.title + ': ' + world.state.mission.objective);
      }
    }
    if (snapshot.pausePressed) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    const snapshot = input.read();
    handleScreenInput(snapshot);
    // Edges fire once per frame: the first fixed step gets the snapshot, any
    // further steps this frame get a held-only copy.
    const heldOnly = { ...snapshot, actionPressed: false, punchPressed: false, confirmPressed: false, pausePressed: false, mutePressed: false };
    let stepInput = snapshot;

    if (screen === SCREEN_TITLE) {
      // Attract mode: the city lives (traffic, pedestrians) while nobody plays.
      while (accumulator >= STEP) {
        world.step(STEP, BLANK_INPUT);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        const events = world.step(STEP, stepInput);
        stepInput = heldOnly;
        accumulator -= STEP;
        if (events & EVENT_BUSTED) announce('Busted. $200 fine.');
        if (events & EVENT_MISSION_DONE) announce('Mission complete. Cash $' + Math.floor(world.state.cash) + '.');
      }
      if (world.state.gameOver) endGame();
    } else {
      accumulator = 0;
    }

    // Continuous sound follows the frame, not the steps.
    const player = world.state.player;
    audio.engine(screen === SCREEN_PLAY && !player.onFoot, Math.abs(player.speed || 0) / CAR.maxSpeed);
    audio.siren(screen === SCREEN_PLAY && world.state.wanted > 0);

    // Sounds and effects read the frame's accumulated flags; the renderer
    // paints first, then the flags are cleared for the next frame.
    const frameEvents = world.state.events;
    playSounds(frameEvents);
    renderer.draw(world.state, screen, best);
    world.state.events = 0;
  }

  // Leaving the tab pauses a running game rather than letting the cops close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Costa Solara. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
