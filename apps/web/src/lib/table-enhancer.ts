/**
 * Search + sort for every table rendered inside the app shell.
 *
 * Most screens build their tables by hand (the ui <Table> primitive or a raw
 * <table>), so rather than rewrite ~150 screens this attaches behaviour to the
 * rendered DOM. It is written to coexist with React, which owns these nodes:
 *
 *  - It never replaces or re-parents a React node. Rows are only reordered
 *    within their own <tbody>, and React tolerates that — it inserts and
 *    removes by node reference, not by index.
 *  - It only writes attributes React does not manage (data-dt*, aria-sort,
 *    tabindex), never `className` or `style`, so a re-render cannot undo it.
 *  - The toolbar is the one node it adds: a sibling placed before the table.
 *
 * Opt out with `data-enhance="off"` on the table, or `data-table-plain` on any
 * ancestor (timetables, printable documents, line-item editors).
 * Per cell, `data-sort-value` overrides the text a column sorts by.
 */
import { compareCellValues, parseDate, parseNumber } from './table-sort';

const SEARCH_MIN_ROWS = 6;
const TOTAL_ROW = /^(grand\s+)?(sub)?totals?\b/i;

type Dir = 'asc' | 'desc';

const SEARCH_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const CLEAR_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function cellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let x = 0;
  for (const cell of Array.from(row.cells)) {
    if (col >= x && col < x + cell.colSpan) return cell;
    x += cell.colSpan;
  }
  return null;
}

function cellValue(cell: HTMLTableCellElement | null): string {
  if (!cell) return '';
  const explicit = cell.getAttribute('data-sort-value');
  if (explicit !== null) return explicit;
  const field = cell.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea');
  if (field) {
    if (field instanceof HTMLSelectElement) return field.selectedOptions[0]?.text ?? '';
    return field.value;
  }
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function rowText(row: HTMLTableRowElement): string {
  let text = row.textContent ?? '';
  row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]), textarea').forEach((f) => {
    if (f.type !== 'checkbox' && f.type !== 'radio') text += ` ${f.value}`;
  });
  row.querySelectorAll('select').forEach((s) => { text += ` ${s.selectedOptions[0]?.text ?? ''}`; });
  return text.replace(/\s+/g, ' ').toLowerCase();
}

/** A row whose single cell spans the table: an empty state, a section heading, or a detail row. */
function isSpanRow(row: HTMLTableRowElement): boolean {
  return row.cells.length === 1 && row.cells[0].colSpan > 1;
}

function isTotalRow(row: HTMLTableRowElement): boolean {
  const first = row.cells[0];
  return !!first && TOTAL_ROW.test((first.textContent ?? '').trim());
}

function isInteractiveHeader(th: HTMLTableCellElement): boolean {
  if (th.getAttribute('data-sortable') === 'false') return true;
  if (th.querySelector('input, button, select, a, [role=checkbox], [role=button]')) return true;
  // Headers the page already sorts itself (server-side sorting).
  if (th.classList.contains('cursor-pointer') || th.hasAttribute('onclick')) return true;
  if (th.hasAttribute('aria-sort') && !th.hasAttribute('data-dt-sortable')) return true;
  return (th.textContent ?? '').trim() === '';
}

class TableController {
  readonly table: HTMLTableElement;
  private toolbar: HTMLDivElement;
  private input: HTMLInputElement;
  private clear: HTMLButtonElement;
  private count: HTMLSpanElement;
  private observer: MutationObserver;
  private query = '';
  private sortCol: number | null = null;
  private sortDir: Dir = 'asc';
  private pending = 0;
  private pendingStructural = false;
  private deferredSort = false;

  constructor(table: HTMLTableElement) {
    this.table = table;
    table.setAttribute('data-dt', '');

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'dt-toolbar dt-toolbar-auto';
    this.toolbar.setAttribute('data-dt-toolbar', '');
    this.toolbar.innerHTML = `<label class="dt-search"><span class="dt-search-icon">${SEARCH_ICON}</span><input type="search" aria-label="Search table" /><button type="button" class="dt-clear" aria-label="Clear search" hidden>${CLEAR_ICON}</button></label><span class="dt-count" aria-live="polite"></span>`;
    this.input = this.toolbar.querySelector('input')!;
    this.clear = this.toolbar.querySelector('button')!;
    this.count = this.toolbar.querySelector('.dt-count')!;
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.clear.hidden = !this.query;
      this.applyFilter();
    });
    this.clear.addEventListener('click', () => {
      this.input.value = '';
      this.query = '';
      this.clear.hidden = true;
      this.applyFilter();
      this.input.focus();
    });
    table.parentNode?.insertBefore(this.toolbar, table);

    table.addEventListener('click', this.onHeaderClick);
    table.addEventListener('keydown', this.onHeaderKey);
    table.addEventListener('focusout', this.onFocusOut);

    this.observer = new MutationObserver(this.onMutate);
    this.refresh();
    this.observe();
  }

  private observe() {
    this.observer.observe(this.table, { childList: true, subtree: true, characterData: true });
  }

  private onMutate = (records: MutationRecord[]) => {
    // Row additions/removals re-sort; text edits only re-filter, so a row
    // never jumps away while somebody is typing a mark into it.
    // Timers, not rAF: rAF stalls in background tabs and the table would go stale.
    this.pendingStructural ||= records.some((r) => r.type === 'childList' && (r.target as Element).tagName === 'TBODY');
    if (this.pending) clearTimeout(this.pending);
    this.pending = window.setTimeout(() => {
      const structural = this.pendingStructural;
      this.pending = 0;
      this.pendingStructural = false;
      this.refresh(structural);
    }, 16);
  };

  private onFocusOut = () => {
    if (!this.deferredSort) return;
    window.setTimeout(() => {
      if (this.table.contains(document.activeElement)) return;
      this.deferredSort = false;
      this.applySort();
    }, 0);
  };

  private headerRow(): HTMLTableRowElement | null {
    const head = this.table.tHead;
    return head && head.rows.length ? head.rows[head.rows.length - 1] : null;
  }

  private headerCells(): Array<{ th: HTMLTableCellElement; col: number }> {
    const row = this.headerRow();
    if (!row) return [];
    let x = 0;
    return Array.from(row.cells).map((th) => {
      const entry = { th, col: x };
      x += th.colSpan;
      return entry;
    });
  }

  private dataRows(): HTMLTableRowElement[] {
    return Array.from(this.table.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => !isSpanRow(r) && !isTotalRow(r));
  }

  refresh(resort = true) {
    const rows = this.dataRows();
    for (const { th, col } of this.headerCells()) {
      const sortable = rows.length > 1 && th.colSpan === 1 && !isInteractiveHeader(th);
      if (sortable) {
        th.setAttribute('data-dt-sortable', '');
        if (!th.hasAttribute('tabindex')) th.tabIndex = 0;
        th.setAttribute('aria-sort', this.sortCol === col ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      } else if (th.hasAttribute('data-dt-sortable')) {
        th.removeAttribute('data-dt-sortable');
        th.removeAttribute('aria-sort');
        th.removeAttribute('tabindex');
      }
    }
    // Figures and dates never wrap mid-value ("UGX / 522,500").
    for (const r of rows) {
      for (const cell of Array.from(r.cells)) {
        const text = (cell.textContent ?? '').trim();
        const figure = text.length > 0 && text.length <= 24 && !cell.querySelector('input, select, textarea')
          && (parseNumber(text) !== null || parseDate(text) !== null);
        if (figure !== cell.hasAttribute('data-dt-fig')) cell.toggleAttribute('data-dt-fig', figure);
      }
    }
    this.toolbar.hidden = rows.length < SEARCH_MIN_ROWS && !this.query;
    this.input.placeholder = `Search ${rows.length} rows…`;
    if (resort) this.applySort();
    this.applyFilter();
    this.observer?.takeRecords();
  }

  private onHeaderClick = (e: MouseEvent) => {
    const th = (e.target as Element).closest('th');
    if (!th || !th.hasAttribute('data-dt-sortable') || !this.table.tHead?.contains(th)) return;
    if ((e.target as Element).closest('input, button, select, a')) return;
    this.toggle(th as HTMLTableCellElement);
  };

  private onHeaderKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target as Element;
    if (th.tagName !== 'TH' || !th.hasAttribute('data-dt-sortable')) return;
    e.preventDefault();
    this.toggle(th as HTMLTableCellElement);
  };

  private toggle(th: HTMLTableCellElement) {
    const col = this.headerCells().find((h) => h.th === th)?.col;
    if (col === undefined) return;
    if (this.sortCol !== col) {
      this.sortCol = col;
      this.sortDir = 'asc';
    } else if (this.sortDir === 'asc') {
      this.sortDir = 'desc';
    } else {
      this.sortCol = null;
    }
    this.refresh(false);
    this.applySort(true);
  }

  /**
   * Sort each <tbody> on its own. Full-width rows split a body into segments
   * (section headings stay put, rows sort beneath them); total rows stay last.
   */
  private applySort(force = false) {
    if (!force && this.table.tBodies.length && Array.from(this.table.tBodies).some((b) => b.contains(document.activeElement))) {
      this.deferredSort = true;
      return;
    }
    const col = this.sortCol;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    let moved = false;
    for (const body of Array.from(this.table.tBodies)) {
      const rows = Array.from(body.rows);
      if (!rows.some((r) => r.hasAttribute('data-dt-i'))) rows.forEach((r, i) => r.setAttribute('data-dt-i', String(i)));
      // Rows React added since the last pass have no original index yet.
      let next = rows.reduce((m, r) => Math.max(m, Number(r.getAttribute('data-dt-i') ?? -1)), -1) + 1;
      rows.forEach((r) => { if (!r.hasAttribute('data-dt-i')) r.setAttribute('data-dt-i', String(next++)); });

      const ordered: HTMLTableRowElement[] = [];
      const tail: HTMLTableRowElement[] = [];
      let segment: HTMLTableRowElement[] = [];
      const flush = () => {
        const keyed = segment.map((r) => ({ r, i: Number(r.getAttribute('data-dt-i')), v: col === null ? '' : cellValue(cellAt(r, col)) }));
        keyed.sort((a, b) => (col === null ? 0 : compareCellValues(a.v, b.v, dir as 1 | -1)) || a.i - b.i);
        ordered.push(...keyed.map((k) => k.r));
        segment = [];
      };
      for (const r of rows) {
        if (isTotalRow(r)) tail.push(r);
        else if (isSpanRow(r)) { flush(); ordered.push(r); }
        else segment.push(r);
      }
      flush();
      ordered.push(...tail);
      if (ordered.some((r, i) => r !== rows[i])) {
        ordered.forEach((r) => body.appendChild(r));
        moved = true;
      }
    }
    if (moved) this.observer.takeRecords();
  }

  private applyFilter() {
    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    let total = 0;
    for (const body of Array.from(this.table.tBodies)) {
      let heading: HTMLTableRowElement | null = null;
      let headingHasMatch = false;
      const closeHeading = () => {
        if (heading) heading.toggleAttribute('data-dt-hidden', tokens.length > 0 && !headingHasMatch);
      };
      for (const r of Array.from(body.rows)) {
        if (isTotalRow(r)) continue;
        if (isSpanRow(r)) {
          closeHeading();
          // A spanning row with nothing but data rows after it is a heading;
          // a lone empty-state row just stays visible.
          heading = r.nextElementSibling ? r : null;
          headingHasMatch = false;
          if (!heading) r.removeAttribute('data-dt-hidden');
          continue;
        }
        total++;
        const match = tokens.length === 0 || tokens.every((t) => rowText(r).includes(t));
        r.toggleAttribute('data-dt-hidden', !match);
        if (match) { shown++; headingHasMatch = true; }
      }
      closeHeading();
    }
    this.observer.takeRecords();
    this.count.textContent = !tokens.length
      ? `${total} ${total === 1 ? 'row' : 'rows'}`
      : shown === 0 ? `No rows match — 0 of ${total}` : `${shown} of ${total}`;
  }

  destroy() {
    this.observer.disconnect();
    if (this.pending) clearTimeout(this.pending);
    this.table.removeEventListener('click', this.onHeaderClick);
    this.table.removeEventListener('keydown', this.onHeaderKey);
    this.table.removeEventListener('focusout', this.onFocusOut);
    this.toolbar.remove();
  }
}

function eligible(table: HTMLTableElement): boolean {
  if (table.getAttribute('data-enhance') === 'off') return false;
  if (table.closest('[data-table-plain], .print-receipt, [contenteditable=true]')) return false;
  if (table.parentElement?.closest('table')) return false;
  if (!table.tHead || !table.tBodies.length) return false;
  const head = table.tHead.rows[table.tHead.rows.length - 1];
  return !!head && head.cells.length >= 2;
}

/** Watch `root` and enhance every eligible table that appears inside it. */
export function enhanceTablesIn(root: HTMLElement): () => void {
  const controllers = new Map<HTMLTableElement, TableController>();
  let frame = 0;

  const scan = () => {
    frame = 0;
    for (const [table, c] of controllers) {
      // The toolbar is not React's, so it goes when the table goes — or when
      // React re-parents the table somewhere the toolbar no longer sits beside it.
      if (!table.isConnected || !root.contains(table)) {
        c.destroy();
        controllers.delete(table);
      }
    }
    root.querySelectorAll('table').forEach((table) => {
      if (controllers.has(table)) return;
      if (!eligible(table)) return;
      controllers.set(table, new TableController(table));
    });
  };

  const observer = new MutationObserver((records) => {
    // Ignore churn inside tables we already manage; their own observer handles it.
    const relevant = records.some((r) =>
      Array.from(r.addedNodes).some((n) => n instanceof HTMLElement && (n.tagName === 'TABLE' || n.querySelector?.('table') || n.tagName === 'THEAD' || n.tagName === 'TBODY'))
      || Array.from(r.removedNodes).some((n) => n instanceof HTMLElement && (n.tagName === 'TABLE' || n.querySelector?.('table'))),
    );
    if (relevant && !frame) frame = window.setTimeout(scan, 16);
  });
  observer.observe(root, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    if (frame) clearTimeout(frame);
    controllers.forEach((c) => c.destroy());
    controllers.clear();
  };
}
