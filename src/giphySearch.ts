import { searchGifs, type GiphyResult } from './giphy';
import { log } from './logger';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

/**
 * A GIPHY search overlay (DOM chrome): a query box + a scrollable results grid.
 * Clicking a result calls `onPick`. Kept out of the canvas — it's just chrome for
 * choosing media; placement/rendering happens on the canvas. Architecture §16.
 */
export function createGiphySearch(opts: { onPick: (result: GiphyResult) => void }): {
  toggle: () => void;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
} {
  const { onPick } = opts;

  const container = el('div', 'gs');
  const bar = el('div', 'gs-bar');
  const input = el('input', 'gs-input');
  input.type = 'search';
  input.placeholder = 'Search GIPHY…';
  const closeBtn = el('button', 'gs-close');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  bar.append(input, closeBtn);
  const results = el('div', 'gs-results');
  const footer = el('div', 'gs-footer');
  footer.textContent = 'Powered by GIPHY';
  container.append(bar, results, footer);
  document.body.append(container);

  let open = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let reqToken = 0;

  function render(items: GiphyResult[]): void {
    results.replaceChildren();
    for (const r of items) {
      const cell = el('button', 'gs-item');
      cell.type = 'button';
      const img = el('img');
      img.src = r.preview;
      img.alt = r.title;
      img.loading = 'lazy';
      cell.append(img);
      cell.addEventListener('click', () => {
        onPick(r);
      });
      results.append(cell);
    }
  }

  function runSearch(query: string): void {
    const token = ++reqToken;
    searchGifs(query)
      .then((items) => {
        if (token === reqToken && open) {
          render(items);
        }
      })
      .catch((err: unknown) => {
        log.input.warn('giphy:search-failed', { err: String(err) });
        if (token === reqToken) {
          results.replaceChildren();
        }
      });
  }

  input.addEventListener('input', () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => runSearch(input.value), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    }
  });
  closeBtn.addEventListener('click', () => {
    close();
  });

  function setOpen(next: boolean): void {
    open = next;
    container.classList.toggle('on', open);
    if (open) {
      input.focus();
    }
  }
  const openFn = () => setOpen(true);
  const closeFn = () => setOpen(false);

  return {
    toggle: () => setOpen(!open),
    open: openFn,
    close: closeFn,
    isOpen: () => open,
  };
}
