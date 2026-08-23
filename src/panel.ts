import type { FlyTune } from './fly';
import type { CameraState, UiState } from './interactions';

/** Live render settings mutated by the panel and uploaded in the camera uniform. */
export type Settings = {
  /** Per-level enable (one per adaptive grid level). */
  levels: boolean[];
  fadeStartPx: number;
  fadeEndPx: number;
  lineAlpha: number;
  lineHalfPx: number;
  /** Φ tail: 0 = rational, 1 = tanh, 2 = atan. */
  tailMode: number;
  axesOn: boolean;
  /** Node rendering: false = anisotropic (warps), true = isotropic (true proportions). */
  isoMode: boolean;
  /** Directional opponent-color tint strength (0 = off). */
  tintStrength: number;
  /** World-space scale of the neutral halo (larger = smoother, broader). */
  tintScale: number;
};

type PanelOptions = {
  settings: Settings;
  cam: CameraState;
  ui: UiState;
  /** Live fly-mode tunables (mutated in place by the Fly section). */
  flyTune: FlyTune;
  /** Enter fly mode (pointer lock) — must run from a user gesture (button click). */
  enterFly: () => void;
  /** Open the GIPHY picker. */
  openGiphy: () => void;
  /** Wipe the saved scene + all tiles. */
  clearScene: () => void;
  levelCount: number;
  /** World spacing of level n (for labels). */
  levelSpacing: (n: number) => number;
  zoomRange: [number, number];
  /** Called after any setting changes (marks the frame dirty). */
  onChange: () => void;
  /** Reset the camera focus + zoom. */
  resetView: () => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function formatSpacing(v: number): string {
  if (v >= 1e6) {
    return `${v / 1e6}M`;
  }
  if (v >= 1e3) {
    return `${v / 1e3}k`;
  }
  return `${v}`;
}

/**
 * Build the collapsible settings panel (DOM chrome around the canvas; §16).
 * All controls read/write the shared `settings`/`cam` objects and call
 * `onChange`; `syncers` re-read state into the controls (used on open / reset).
 */
export function createSettingsPanel(opts: PanelOptions): { refresh: () => void } {
  const {
    settings,
    cam,
    ui,
    flyTune,
    enterFly,
    openGiphy,
    clearScene,
    levelCount,
    levelSpacing,
    zoomRange,
    onChange,
    resetView,
  } = opts;
  const defaults = structuredClone(settings);
  const syncers: (() => void)[] = [];
  const refresh = () => {
    for (const sync of syncers) {
      sync();
    }
  };

  const container = el('div', 'sp');
  const header = el('div', 'sp-header');
  header.append(el('span', 'sp-title', '⚙  Grid'));
  const chevron = el('span', 'sp-chevron', '▸');
  header.append(chevron);
  const body = el('div', 'sp-body');
  container.append(header, body);

  let open = false;
  header.addEventListener('click', () => {
    open = !open;
    container.classList.toggle('sp-open', open);
    chevron.textContent = open ? '▾' : '▸';
    if (open) {
      refresh();
    }
  });

  const section = (label: string): HTMLDivElement => {
    const s = el('div', 'sp-section');
    s.append(el('div', 'sp-label', label));
    body.append(s);
    return s;
  };

  const addSlider = (
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
  ): void => {
    const row = el('div', 'sp-slider');
    const input = el('input', 'sp-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('span', 'sp-sval');
    const digits = step < 1 ? 2 : 0;
    const sync = () => {
      input.value = String(get());
      val.textContent = get().toFixed(digits);
    };
    input.addEventListener('input', () => {
      set(Number.parseFloat(input.value));
      val.textContent = get().toFixed(digits);
      onChange();
    });
    syncers.push(sync);
    row.append(el('span', 'sp-slabel', label), input, val);
    parent.append(row);
  };

  // --- Fly mode (experiment) ---
  const flySec = section('Movement');
  const flyRow = el('div', 'sp-row');
  const flyBtn = el('button', 'sp-btn', 'Fly (Shift)');
  flyBtn.type = 'button';
  const flyBtnSync = () => {
    flyBtn.textContent = ui.locked ? 'Flying — Shift/Esc = grab' : 'Fly (Shift)';
    flyBtn.classList.toggle('on', ui.locked);
  };
  flyBtn.addEventListener('click', () => {
    if (!ui.locked) {
      enterFly();
    }
  });
  syncers.push(flyBtnSync);
  flyRow.append(flyBtn);
  flySec.append(flyRow);
  const ringLabel = el('label', 'sp-check');
  const ringInput = el('input');
  ringInput.type = 'checkbox';
  const ringSync = () => {
    ringInput.checked = flyTune.showHud;
  };
  ringInput.addEventListener('change', () => {
    flyTune.showHud = ringInput.checked;
    onChange();
  });
  syncers.push(ringSync);
  ringLabel.append(ringInput, el('span', undefined, 'show ring + hint'));
  flySec.append(ringLabel);
  addSlider(
    flySec,
    'sens',
    0.1,
    4,
    0.05,
    () => flyTune.sensitivity,
    (v) => {
      flyTune.sensitivity = v;
    },
  );
  addSlider(
    flySec,
    'radius',
    100,
    Math.round(Math.hypot(window.innerWidth / 2, window.innerHeight / 2)),
    20,
    () => flyTune.radiusPx,
    (v) => {
      flyTune.radiusPx = v;
    },
  );
  addSlider(
    flySec,
    'max spd',
    200,
    6400,
    50,
    () => flyTune.maxSpeedPx,
    (v) => {
      flyTune.maxSpeedPx = v;
    },
  );
  addSlider(
    flySec,
    'deadzone',
    0,
    60,
    1,
    () => flyTune.deadzonePx,
    (v) => {
      flyTune.deadzonePx = v;
    },
  );
  addSlider(
    flySec,
    'curve',
    1,
    4,
    0.1,
    () => flyTune.curveExp,
    (v) => {
      flyTune.curveExp = v;
    },
  );

  // --- Media (GIPHY) ---
  const mediaSec = section('Media');
  const mediaRow = el('div', 'sp-row');
  const giphyBtn = el('button', 'sp-btn', 'Add media (A)');
  giphyBtn.type = 'button';
  giphyBtn.addEventListener('click', () => openGiphy());
  mediaRow.append(giphyBtn);
  mediaSec.append(mediaRow);

  // --- Grid levels ---
  const levelsSec = section('Grid levels (world spacing)');
  const chips = el('div', 'sp-chips');
  for (let n = 0; n < levelCount; n++) {
    const chip = el('button', 'sp-chip', formatSpacing(levelSpacing(n)));
    chip.type = 'button';
    const sync = () => chip.classList.toggle('on', settings.levels[n]);
    chip.addEventListener('click', () => {
      settings.levels[n] = !settings.levels[n];
      sync();
      onChange();
    });
    syncers.push(sync);
    chips.append(chip);
  }
  levelsSec.append(chips);
  const levelBtns = el('div', 'sp-row');
  const allBtn = el('button', 'sp-btn', 'All');
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => {
    settings.levels.fill(true);
    refresh();
    onChange();
  });
  const noneBtn = el('button', 'sp-btn', 'None');
  noneBtn.type = 'button';
  noneBtn.addEventListener('click', () => {
    settings.levels.fill(false);
    refresh();
    onChange();
  });
  levelBtns.append(allBtn, noneBtn);
  levelsSec.append(levelBtns);

  // --- Edge fade ---
  const fadeSec = section('Edge fade (device px)');
  addSlider(
    fadeSec,
    'start',
    0.5,
    20,
    0.5,
    () => settings.fadeStartPx,
    (v) => {
      settings.fadeStartPx = Math.min(v, settings.fadeEndPx - 0.5);
    },
  );
  addSlider(
    fadeSec,
    'end',
    1,
    40,
    0.5,
    () => settings.fadeEndPx,
    (v) => {
      settings.fadeEndPx = Math.max(v, settings.fadeStartPx + 0.5);
    },
  );

  // --- Line ---
  const lineSec = section('Line');
  addSlider(
    lineSec,
    'opacity',
    0,
    0.3,
    0.005,
    () => settings.lineAlpha,
    (v) => {
      settings.lineAlpha = v;
    },
  );
  addSlider(
    lineSec,
    'width',
    0.25,
    2,
    0.05,
    () => settings.lineHalfPx,
    (v) => {
      settings.lineHalfPx = v;
    },
  );

  // --- Projection ---
  const projSec = section('Projection');
  const tailRow = el('div', 'sp-slider');
  tailRow.append(el('span', 'sp-slabel', 'tail'));
  const tailSel = el('select', 'sp-select');
  for (const [i, name] of ['rational', 'tanh', 'atan'].entries()) {
    const option = el('option', undefined, name);
    option.value = String(i);
    tailSel.append(option);
  }
  const tailSync = () => {
    tailSel.value = String(settings.tailMode);
  };
  tailSel.addEventListener('change', () => {
    settings.tailMode = Number.parseInt(tailSel.value, 10);
    onChange();
  });
  syncers.push(tailSync);
  tailRow.append(tailSel);
  projSec.append(tailRow);
  addSlider(
    projSec,
    'zoom',
    zoomRange[0],
    zoomRange[1],
    0.01,
    () => cam.zoom,
    (v) => {
      cam.zoom = v;
    },
  );
  const isoLabel = el('label', 'sp-check');
  const isoInput = el('input');
  isoInput.type = 'checkbox';
  const isoSync = () => {
    isoInput.checked = settings.isoMode;
  };
  isoInput.addEventListener('change', () => {
    settings.isoMode = isoInput.checked;
    onChange();
  });
  syncers.push(isoSync);
  isoLabel.append(isoInput, el('span', undefined, 'isotropic nodes (true proportions)'));
  projSec.append(isoLabel);

  // --- Origin axes ---
  const axesSec = section('Origin axes');
  const axesLabel = el('label', 'sp-check');
  const axesInput = el('input');
  axesInput.type = 'checkbox';
  const axesSync = () => {
    axesInput.checked = settings.axesOn;
  };
  axesInput.addEventListener('change', () => {
    settings.axesOn = axesInput.checked;
    onChange();
  });
  syncers.push(axesSync);
  axesLabel.append(axesInput, el('span', undefined, 'show axes'));
  axesSec.append(axesLabel);

  // --- Colour ---
  const colorSec = section('Colour');
  addSlider(
    colorSec,
    'dir tint',
    0,
    0.8,
    0.02,
    () => settings.tintStrength,
    (v) => {
      settings.tintStrength = v;
    },
  );
  addSlider(
    colorSec,
    'tint scale',
    300,
    15000,
    100,
    () => settings.tintScale,
    (v) => {
      settings.tintScale = v;
    },
  );

  // --- Actions ---
  const actions = el('div', 'sp-row sp-actions');
  const resetSettingsBtn = el('button', 'sp-btn', 'Reset settings');
  resetSettingsBtn.type = 'button';
  resetSettingsBtn.addEventListener('click', () => {
    settings.levels = [...defaults.levels];
    settings.fadeStartPx = defaults.fadeStartPx;
    settings.fadeEndPx = defaults.fadeEndPx;
    settings.lineAlpha = defaults.lineAlpha;
    settings.lineHalfPx = defaults.lineHalfPx;
    settings.tailMode = defaults.tailMode;
    settings.axesOn = defaults.axesOn;
    settings.isoMode = defaults.isoMode;
    settings.tintStrength = defaults.tintStrength;
    settings.tintScale = defaults.tintScale;
    refresh();
    onChange();
  });
  const resetViewBtn = el('button', 'sp-btn', 'Reset view');
  resetViewBtn.type = 'button';
  resetViewBtn.addEventListener('click', () => {
    resetView();
    refresh();
  });
  actions.append(resetSettingsBtn, resetViewBtn);
  body.append(actions);

  // --- Scene (persistence) ---
  const sceneRow = el('div', 'sp-row sp-actions');
  const clearBtn = el('button', 'sp-btn', 'Clear saved scene');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', () => {
    clearScene();
  });
  sceneRow.append(clearBtn);
  body.append(sceneRow);

  document.body.append(container);
  refresh();
  return { refresh };
}
