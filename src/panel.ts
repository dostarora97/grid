import type { CameraState } from './interactions';

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
};

type PanelOptions = {
  settings: Settings;
  cam: CameraState;
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
export function createSettingsPanel(opts: PanelOptions): void {
  const { settings, cam, levelCount, levelSpacing, zoomRange, onChange, resetView } = opts;
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

  document.body.append(container);
  refresh();
}
