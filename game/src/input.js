// Costa Solara — keyboard and pointer input for an open-world game.
// Held keys steer and drive; one-shot presses (steal, punch, confirm, pause,
// mute) are queued as edge flags and taken once per frame by read(), so a
// press between two frames is never lost and never counted twice. Losing
// focus releases every held key, so the car never drives itself after Alt-Tab.

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const HANDBRAKE = new Set(['Space']);
const ACTION = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const CONFIRM = new Set(['Enter', 'Space']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);

/** True when the key is one this game uses (so it can swallow the default). */
function isGameKey(code) {
  return UP.has(code) || DOWN.has(code) || LEFT.has(code) || RIGHT.has(code) ||
    RUN.has(code) || HANDBRAKE.has(code) || ACTION.has(code) || PUNCH.has(code) ||
    CONFIRM.has(code) || PAUSE.has(code) || MUTE.has(code);
}

export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false, run: false, handbrake: false };
  let actionPressed = false;
  let punchPressed = false;
  let confirmPressed = false;
  let pausePressed = false;
  let mutePressed = false;

  function releaseAll() {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
    held.run = false;
    held.handbrake = false;
  }

  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (!isGameKey(code)) return;
    event.preventDefault();
    if (UP.has(code)) held.up = true;
    else if (DOWN.has(code)) held.down = true;
    else if (LEFT.has(code)) held.left = true;
    else if (RIGHT.has(code)) held.right = true;
    else if (RUN.has(code)) held.run = true;
    else if (HANDBRAKE.has(code)) held.handbrake = true;
    if (event.repeat) return;
    if (ACTION.has(code)) actionPressed = true;
    else if (PUNCH.has(code)) punchPressed = true;
    else if (CONFIRM.has(code)) confirmPressed = true;
    else if (PAUSE.has(code)) pausePressed = true;
    else if (MUTE.has(code)) mutePressed = true;
  });

  window.addEventListener('keyup', (event) => {
    const code = event.code;
    if (UP.has(code)) held.up = false;
    else if (DOWN.has(code)) held.down = false;
    else if (LEFT.has(code)) held.left = false;
    else if (RIGHT.has(code)) held.right = false;
    else if (RUN.has(code)) held.run = false;
    else if (HANDBRAKE.has(code)) held.handbrake = false;
  });

  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', releaseAll);

  // Clicking the canvas confirms (start, resume, accept a mission brief).
  target.addEventListener('pointerdown', () => {
    confirmPressed = true;
  });

  return {
    /**
     * This frame's input: held directions plus the one-shot presses since the
     * last call. The edge flags are cleared here, so the caller must pass the
     * same snapshot (or a held-only copy) to every fixed step of this frame.
     */
    read() {
      const snapshot = {
        up: held.up,
        down: held.down,
        left: held.left,
        right: held.right,
        run: held.run,
        handbrake: held.handbrake,
        actionPressed,
        punchPressed,
        confirmPressed,
        pausePressed,
        mutePressed,
      };
      actionPressed = false;
      punchPressed = false;
      confirmPressed = false;
      pausePressed = false;
      mutePressed = false;
      return snapshot;
    },
  };
}
