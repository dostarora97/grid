import { Logger } from 'tslog';

/*
 * Verbose, structured, timestamped logging for the whole app (tslog).
 *
 * Fully verbose by default (minLevel = SILLY = 0). The high-frequency streams —
 * raw input and per-frame renders — log at SILLY/TRACE, so you can quiet the
 * firehose live from the console without a rebuild:
 *
 *     gridLog.settings.minLevel = 3   // INFO and above only
 *     gridLog.settings.minLevel = 0   // back to fully verbose
 *
 * Levels: 0 SILLY · 1 TRACE · 2 DEBUG · 3 INFO · 4 WARN · 5 ERROR · 6 FATAL.
 * Objects are passed through whole (not field-by-field) so the browser console
 * shows them expandable; every line carries a timestamp and a subsystem name.
 */

/** Default verbosity — SILLY captures everything. Raise it to tame the console. */
const MIN_LEVEL = 0;

export const rootLog = new Logger({ name: 'grid', minLevel: MIN_LEVEL, type: 'pretty' });

/** Per-subsystem sub-loggers; each line is tagged with its own name. */
export const log = {
  boot: rootLog.getSubLogger({ name: 'boot' }),
  frame: rootLog.getSubLogger({ name: 'frame' }),
  camera: rootLog.getSubLogger({ name: 'camera' }),
  input: rootLog.getSubLogger({ name: 'input' }),
  glide: rootLog.getSubLogger({ name: 'glide' }),
  resize: rootLog.getSubLogger({ name: 'resize' }),
  rawInput: rootLog.getSubLogger({ name: 'raw-input' }),
};

declare global {
  interface Window {
    /** The root logger, exposed for live tuning: `gridLog.settings.minLevel = 3`. */
    gridLog: typeof rootLog;
  }
}

if (typeof window !== 'undefined') {
  window.gridLog = rootLog;
  rootLog.info('logger ready — set gridLog.settings.minLevel (0 SILLY … 6 FATAL) to filter', {
    minLevel: MIN_LEVEL,
  });
}
