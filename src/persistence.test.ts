import { describe, expect, it } from 'vitest';
import { parseScene } from './persistence';

describe('parseScene', () => {
  it('returns null for absent / non-JSON / non-object input', () => {
    expect(parseScene(null)).toBeNull();
    expect(parseScene('')).toBeNull();
    expect(parseScene('not json{')).toBeNull();
    expect(parseScene('42')).toBeNull();
    expect(parseScene('null')).toBeNull();
  });

  it('rejects an unknown version or a missing rects array', () => {
    expect(parseScene(JSON.stringify({ version: 999, rects: [] }))).toBeNull();
    expect(parseScene(JSON.stringify({ version: 1, rects: 'nope' }))).toBeNull();
  });

  it('parses a valid scene with rects, nextId, and view', () => {
    const raw = JSON.stringify({
      version: 1,
      rects: [{ id: 1, x0: 0, y0: 0, x1: 2, y1: 1 }],
      nextId: 2,
      view: { focusX: 10, focusY: -5, zoom: 1.5 },
    });
    const scene = parseScene(raw);
    expect(scene).not.toBeNull();
    expect(scene?.rects).toHaveLength(1);
    expect(scene?.nextId).toBe(2);
    expect(scene?.view).toEqual({ focusX: 10, focusY: -5, zoom: 1.5 });
  });

  it('drops malformed rectangles but keeps valid ones', () => {
    const raw = JSON.stringify({
      version: 1,
      rects: [
        { id: 1, x0: 0, y0: 0, x1: 1, y1: 1 },
        { id: 2, x0: 'bad', y0: 0, x1: 1, y1: 1 },
        { nope: true },
      ],
    });
    const scene = parseScene(raw);
    expect(scene?.rects).toHaveLength(1);
    expect(scene?.rects[0].id).toBe(1);
  });

  it('derives nextId from the rects when it is missing', () => {
    const raw = JSON.stringify({
      version: 1,
      rects: [
        { id: 3, x0: 0, y0: 0, x1: 1, y1: 1 },
        { id: 7, x0: 0, y0: 0, x1: 1, y1: 1 },
      ],
    });
    expect(parseScene(raw)?.nextId).toBe(8); // max id + 1
  });

  it('ignores a malformed view but still returns the scene', () => {
    const raw = JSON.stringify({
      version: 1,
      rects: [],
      nextId: 1,
      view: { focusX: 0, zoom: 'x' },
    });
    const scene = parseScene(raw);
    expect(scene).not.toBeNull();
    expect(scene?.view).toBeUndefined();
  });
});
