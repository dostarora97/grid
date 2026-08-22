import { log } from './logger';

/*
 * Raw input telemetry — captures EVERY pointer, wheel, mouse, and keyboard event
 * as a full snapshot object (plus the live native `event` for deep inspection),
 * at SILLY level. This is the firehose: hovering the canvas emits a pointermove
 * per mouse sample. Quiet it with `gridLog.settings.minLevel = 3`.
 *
 * Kept separate from interactions.ts on purpose: this is pure observation and
 * changes no state, while interactions.ts logs the *meaningful* transitions
 * (pan start/end, zoom deltas, glide) with computed world coordinates.
 */

function pointerSnapshot(e: PointerEvent) {
  return {
    type: e.type,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    isPrimary: e.isPrimary,
    client: { x: e.clientX, y: e.clientY },
    movement: { x: e.movementX, y: e.movementY },
    buttons: e.buttons,
    button: e.button,
    pressure: e.pressure,
    mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    event: e,
  };
}

function wheelSnapshot(e: WheelEvent) {
  return {
    type: e.type,
    delta: { x: e.deltaX, y: e.deltaY, z: e.deltaZ, mode: e.deltaMode },
    client: { x: e.clientX, y: e.clientY },
    mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    event: e,
  };
}

function mouseSnapshot(e: MouseEvent) {
  return {
    type: e.type,
    client: { x: e.clientX, y: e.clientY },
    button: e.button,
    buttons: e.buttons,
    detail: e.detail,
    mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    event: e,
  };
}

function keySnapshot(e: KeyboardEvent) {
  return {
    type: e.type,
    key: e.key,
    code: e.code,
    repeat: e.repeat,
    mods: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    event: e,
  };
}

/** Attach passive listeners that log every raw input event (SILLY). */
export function attachInputTelemetry(canvas: HTMLElement): void {
  const rl = log.rawInput;

  const pointerEvents = [
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointercancel',
    'pointerenter',
    'pointerleave',
  ] as const;
  for (const type of pointerEvents) {
    canvas.addEventListener(type, (e) => rl.silly(type, pointerSnapshot(e as PointerEvent)), {
      passive: true,
    });
  }

  canvas.addEventListener('wheel', (e) => rl.silly('wheel', wheelSnapshot(e as WheelEvent)), {
    passive: true,
  });

  const mouseEvents = ['click', 'dblclick', 'contextmenu'] as const;
  for (const type of mouseEvents) {
    canvas.addEventListener(type, (e) => rl.silly(type, mouseSnapshot(e as MouseEvent)), {
      passive: true,
    });
  }

  window.addEventListener('keydown', (e) => rl.silly('keydown', keySnapshot(e)), { passive: true });
  window.addEventListener('keyup', (e) => rl.silly('keyup', keySnapshot(e)), { passive: true });

  rl.debug('input telemetry attached', { pointerEvents, mouseEvents, keys: ['keydown', 'keyup'] });
}
