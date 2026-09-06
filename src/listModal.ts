import {
  App,
  Component,
  MarkdownRenderer,
  Modal,
  Platform,
  SearchResult,
  TFile,
  prepareFuzzySearch,
  renderMatches,
} from "obsidian";
import type NoteFlipPlugin from "./main";
import { t } from "./i18n";
import { openNote } from "./openNote";

interface Row {
  file: TFile;
  /** Fuzzy match of the query against the file name, if any. */
  nameMatch: SearchResult | null;
  /** The line of the note shown in the "match" column. */
  snippet: string;
  /** Whether the snippet contains the query (as opposed to being the first line). */
  snippetMatches: boolean;
  /** 0-based line of the match in the file on disk, so the editor can scroll to it. */
  line: number | null;
}

/** A note's text with the front matter stripped, and how many lines that removed. */
interface Body {
  text: string;
  lineOffset: number;
  /** First non-empty line, shown as the snippet when there is no query. */
  first: string;
  /** Lower-cased text, built on the first search and kept for later keystrokes. */
  lower?: string;
}

const EMPTY_BODY: Body = { text: "", lineOffset: 0, first: "" };

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
/** Longest snippet shown in the match column. */
const SNIPPET_CHARS = 160;
/** Characters kept before the match when a long line is clipped. */
const SNIPPET_LEAD_CHARS = 30;
/** Rows rendered at once; the counter still reports the full number of hits. */
const MAX_ROWS = 300;
/** Longest note text that is rendered in the preview pane. */
const PREVIEW_CHARS = 30000;
/** Files read concurrently while the note texts are loaded. */
const READ_BATCH = 24;
/** While notes are still loading, a query's results are recomputed at most this often. */
const REFRESH_THROTTLE_MS = 150;
/** Quiet time after the selection last moved before the preview is rendered. */
const PREVIEW_DEBOUNCE_MS = 60;
const PAGE_STEP = 10;

/** Split the query into terms; every term has to occur in a note for it to match. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/** Merged [start, end) ranges where any term occurs in `text` (case-insensitive). */
function matchRanges(text: string, terms: string[]): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      ranges.push([at, at + term.length]);
      from = at + Math.max(1, term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** Append `text` to `el`, wrapping every occurrence of the terms in a highlight. */
function appendHighlighted(el: HTMLElement | DocumentFragment, text: string, terms: string[]): void {
  let at = 0;
  for (const [start, end] of matchRanges(text, terms)) {
    if (start > at) el.appendText(text.slice(at, start));
    el.createEl("mark", { cls: "nf-list-mark", text: text.slice(start, end) });
    at = end;
  }
  if (at < text.length) el.appendText(text.slice(at));
}

/** Wrap term occurrences inside every text node under `root`; returns the first highlight. */
function highlightTree(root: HTMLElement, terms: string[]): HTMLElement | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  let first: HTMLElement | null = null;
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    if (!matchRanges(text, terms).length) continue;
    const fragment = doc.createDocumentFragment();
    appendHighlighted(fragment, text, terms);
    first = first ?? (fragment.querySelector("mark") as HTMLElement | null);
    node.parentNode?.replaceChild(fragment, node);
  }
  return first;
}

/** First non-empty line of the body, used as the snippet when there is no query. */
function firstLine(body: string): string {
  // Scan line by line instead of splitting the whole note; the body has its
  // leading whitespace stripped, so this usually returns after one line.
  for (let start = 0; start < body.length; ) {
    const at = body.indexOf("\n", start);
    const end = at < 0 ? body.length : at;
    const trimmed = body.slice(start, end).trim();
    if (trimmed) return trimmed.slice(0, SNIPPET_CHARS);
    start = end + 1;
  }
  return "";
}

function countLines(text: string): number {
  let count = 0;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/** Strip the front matter and remember how many lines were dropped in front of the body. */
function toBody(raw: string): Body {
  const text = raw.replace(FRONTMATTER_RE, "").trimStart();
  return { text, lineOffset: countLines(raw.slice(0, raw.length - text.length)), first: firstLine(text) };
}

/** Lower-cased note text, computed once per note rather than once per keystroke. */
function lowerOf(body: Body): string {
  if (body.lower === undefined) body.lower = body.text.toLowerCase();
  return body.lower;
}

/** The line holding the earliest occurrence of any term, clipped around it, with its 0-based index. */
function matchingLine(body: Body, terms: string[]): { line: string; index: number } | null {
  const text = body.text;
  const lower = lowerOf(body);
  let earliest = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at < 0) return null;
    if (earliest < 0 || at < earliest) earliest = at;
  }
  const lineStart = text.lastIndexOf("\n", earliest) + 1;
  const lineEndAt = text.indexOf("\n", earliest);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const rawLine = text.slice(lineStart, lineEnd);
  const leading = rawLine.length - rawLine.trimStart().length;
  const offset = earliest - lineStart - leading;
  let line = rawLine.trim();
  if (line.length > SNIPPET_CHARS) {
    const from = Math.max(0, Math.min(offset - SNIPPET_LEAD_CHARS, line.length - SNIPPET_CHARS));
    line = (from > 0 ? "…" : "") + line.slice(from, from + SNIPPET_CHARS) + "…";
  }
  return { line, index: countLines(text.slice(0, lineStart)) };
}

/**
 * fzf style note picker: a centred popup with a query box on top, a list of
 * `file name | matching line` rows underneath and a preview of the selected
 * note beside it. Typing narrows the list by file name and note contents.
 */
export class ListModal extends Modal {
  private readonly renderComponent = new Component();
  private readonly bodies = new Map<string, Body>();
  /** Position of every candidate in `files`; with no query the rows are in the same order. */
  private readonly fileIndex = new Map<string, number>();
  private rows: Row[] = [];
  /** Row elements currently on screen, parallel to the first MAX_ROWS of `rows`. */
  private rowEls: HTMLElement[] = [];
  private selectedEl: HTMLElement | null = null;
  private index = 0;
  private query = "";
  private loading = true;
  private closed = false;
  private opening = false;
  private previewToken = 0;
  /** `path\nquery` of the preview last rendered (or in flight), to skip redundant renders. */
  private previewedKey: string | null = null;
  private previewTimer = 0;
  private refreshTimer = 0;

  private inputEl!: HTMLInputElement;
  private counterEl!: HTMLElement;
  private listEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private previewTitleEl!: HTMLElement;
  private previewBodyEl!: HTMLElement;

  constructor(
    app: App,
    private readonly plugin: NoteFlipPlugin,
    private readonly files: TFile[],
    /** Modifier keys that were held down when the picker was triggered. */
    private readonly heldModifiers: Set<string>,
  ) {
    super(app);
  }

  onOpen(): void {
    const s = this.plugin.settings;
    this.renderComponent.load();
    this.containerEl.addClass("nf-list-container", `nf-theme-${s.theme}`);
    this.modalEl.addClass("nf-list-modal");

    this.contentEl.empty();
    this.buildInput();
    const body = this.contentEl.createDiv({ cls: "nf-list-body" });
    this.listEl = body.createDiv({ cls: "nf-list-results" });
    this.listEl.setAttr("role", "listbox");
    this.previewEl = body.createDiv({ cls: "nf-list-preview" });
    this.previewTitleEl = this.previewEl.createDiv({ cls: "nf-list-preview-title" });
    this.previewBodyEl = this.previewEl.createDiv({ cls: "nf-list-preview-body markdown-rendered" });
    this.buildHints();

    this.files.forEach((file, i) => this.fileIndex.set(file.path, i));
    this.rows = this.files.map((file) => this.rowFor(file, []));
    this.index = s.startOnPrevious && this.rows.length > 1 ? 1 : 0;
    this.renderRows();
    this.registerListeners();
    this.inputEl.focus();
    void this.loadBodies();
  }

  onClose(): void {
    this.closed = true;
    window.clearTimeout(this.previewTimer);
    window.clearTimeout(this.refreshTimer);
    this.renderComponent.unload();
    this.bodies.clear();
    this.rows = [];
    this.rowEls = [];
    this.selectedEl = null;
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  private buildInput(): void {
    const row = this.contentEl.createDiv({ cls: "nf-list-input-row" });
    row.createSpan({ cls: "nf-list-prompt", text: ">" });
    this.inputEl = row.createEl("input", {
      cls: "nf-list-input",
      attr: { type: "text", placeholder: t("listPlaceholder"), spellcheck: "false", autocomplete: "off" },
    });
    this.counterEl = row.createSpan({ cls: "nf-list-counter" });

    const header = this.contentEl.createDiv({ cls: "nf-list-header" });
    header.createSpan({ cls: "nf-list-col-name", text: t("listColName") });
    header.createSpan({ cls: "nf-list-col-match", text: t("listColMatch") });
  }

  private buildHints(): void {
    if (!this.plugin.settings.showHints) return;
    const hints = this.contentEl.createDiv({ cls: "nf-list-hints" });
    const addHint = (keys: string, label: string) => {
      const hint = hints.createSpan({ cls: "nf-hint" });
      hint.createEl("kbd", { text: keys });
      hint.createSpan({ text: label });
    };
    addHint("↑↓", t("hintMove"));
    addHint("Enter", t("hintOpen"));
    addHint("Esc", t("hintClose"));
    if (!Platform.isMobile) addHint("Ctrl+N/P", t("hintMove"));
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  /**
   * Read every candidate note so that the query can search their contents.
   * Each batch only touches what it changes: with no query the affected rows
   * get their snippet filled in where they are, and with a query the result
   * list is recomputed at a throttled pace instead of once per batch.
   */
  private async loadBodies(): Promise<void> {
    const pending = this.files.slice();
    while (pending.length && !this.closed) {
      const batch = pending.splice(0, READ_BATCH);
      await Promise.all(
        batch.map(async (file) => {
          try {
            this.bodies.set(file.path, toBody(await this.app.vault.cachedRead(file)));
          } catch {
            this.bodies.set(file.path, EMPTY_BODY);
          }
        }),
      );
      if (this.closed) return;
      if (queryTerms(this.query).length) this.scheduleRefresh();
      else this.fillSnippets(batch);
    }
    this.loading = false;
    if (this.closed) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
    if (queryTerms(this.query).length) this.refresh(true);
    else this.updateCounter();
  }

  /** Put the first line of freshly loaded notes into their rows without rebuilding the list. */
  private fillSnippets(files: TFile[]): void {
    for (const file of files) {
      const i = this.fileIndex.get(file.path);
      if (i === undefined) continue;
      const row = this.rows[i];
      if (!row || row.file !== file) continue;
      row.snippet = (this.bodies.get(file.path) ?? EMPTY_BODY).first;
      const el = this.rowEls[i];
      if (el) el.querySelector(".nf-list-snippet")?.setText(row.snippet);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (!this.closed) this.refresh(true);
    }, REFRESH_THROTTLE_MS);
  }

  private rowFor(file: TFile, terms: string[]): Row {
    const body = this.bodies.get(file.path) ?? EMPTY_BODY;
    const match = terms.length ? matchingLine(body, terms) : null;
    return {
      file,
      nameMatch: null,
      snippet: match ? match.line : body.first,
      snippetMatches: match !== null,
      line: match ? body.lineOffset + match.index : null,
    };
  }

  private computeRows(): Row[] {
    const terms = queryTerms(this.query);
    if (!terms.length) return this.files.map((file) => this.rowFor(file, terms));

    const fuzzy = prepareFuzzySearch(this.query);
    const byName: Row[] = [];
    const byContent: Row[] = [];
    for (const file of this.files) {
      const nameMatch = fuzzy(file.basename) ?? fuzzy(file.path);
      const row = this.rowFor(file, terms);
      row.nameMatch = nameMatch;
      if (nameMatch) byName.push(row);
      else if (row.snippetMatches) byContent.push(row);
    }
    byName.sort((a, b) => (b.nameMatch?.score ?? 0) - (a.nameMatch?.score ?? 0));
    return byName.concat(byContent);
  }

  /** Recompute the rows; `keepSelection` keeps the same note selected when it is still listed. */
  private refresh(keepSelection: boolean): void {
    const selectedPath = this.rows[this.index]?.file.path;
    this.rows = this.computeRows();
    const keep = keepSelection ? this.rows.findIndex((r) => r.file.path === selectedPath) : -1;
    this.index = Math.max(0, keep);
    this.renderRows();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private renderRows(): void {
    const terms = queryTerms(this.query);
    this.listEl.empty();
    this.rowEls = [];
    this.selectedEl = null;
    // Rows are built off-screen and attached in one go. Clicks are handled by
    // a single listener on the list (see registerListeners), not per row.
    const fragment = createFragment();
    this.rows.slice(0, MAX_ROWS).forEach((row, i) => {
      const el = fragment.createDiv({ cls: "nf-list-row", attr: { role: "option", "aria-selected": "false" } });
      el.dataset.index = String(i);

      const nameEl = el.createDiv({ cls: "nf-list-name" });
      const nameText = nameEl.createSpan({ cls: "nf-list-name-text" });
      if (row.nameMatch) renderMatches(nameText, row.file.basename, row.nameMatch.matches);
      else nameText.setText(row.file.basename || t("untitled"));
      const folder = row.file.parent && row.file.parent.path !== "/" ? row.file.parent.path : "";
      if (folder) nameEl.createSpan({ cls: "nf-list-folder", text: folder });

      const snippetEl = el.createDiv({ cls: "nf-list-snippet" });
      if (row.snippetMatches) appendHighlighted(snippetEl, row.snippet, terms);
      else snippetEl.setText(row.snippet);
      this.rowEls.push(el);
    });
    const total = this.rows.length;
    this.listEl.toggleClass("nf-list-empty", total === 0);
    if (!total) fragment.createDiv({ cls: "nf-list-none", text: t("noMatch") });
    this.listEl.appendChild(fragment);
    this.updateSelection();
  }

  private updateSelection(): void {
    const el = this.rowEls[this.index] ?? null;
    const previous = this.selectedEl;
    if (previous && previous !== el) {
      previous.removeClass("is-selected");
      previous.setAttr("aria-selected", "false");
    }
    if (el) {
      el.addClass("is-selected");
      el.setAttr("aria-selected", "true");
      el.scrollIntoView({ block: "nearest" });
    }
    this.selectedEl = el;
    this.updateCounter();
    this.schedulePreview();
  }

  private updateCounter(): void {
    const total = this.rows.length;
    const shown = Math.min(total, MAX_ROWS);
    const position = total ? `${this.index + 1}/${total}` : "0/0";
    this.counterEl.setText(this.loading ? `${position} ${t("listLoading")}` : shown < total ? `${position} (${shown})` : position);
  }

  /**
   * Render the preview once the selection has settled. Holding an arrow key
   * would otherwise render every note the cursor passes over, and the render
   * is skipped entirely when the same note is already showing.
   */
  private schedulePreview(): void {
    const row = this.rows[this.index];
    const key = row ? `${row.file.path}\n${this.query}` : "";
    window.clearTimeout(this.previewTimer);
    this.previewTimer = 0;
    if (key === this.previewedKey) return;
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = 0;
      void this.renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  private async renderPreview(): Promise<void> {
    const token = ++this.previewToken;
    const row = this.rows[this.index];
    this.previewedKey = row ? `${row.file.path}\n${this.query}` : "";
    this.previewTitleEl.setText(row ? row.file.path : "");
    this.previewBodyEl.empty();
    if (!row) return;

    const s = this.plugin.settings;
    let text = this.bodies.get(row.file.path)?.text;
    if (text === undefined) {
      try {
        text = toBody(await this.app.vault.cachedRead(row.file)).text;
      } catch {
        text = "";
      }
      if (token !== this.previewToken) return;
    }
    if (text.length > PREVIEW_CHARS) text = text.slice(0, PREVIEW_CHARS) + "\n…";

    const target = this.previewBodyEl.createDiv();
    if (s.renderMarkdown) {
      try {
        await MarkdownRenderer.render(this.app, text, target, row.file.path, this.renderComponent);
      } catch {
        target.setText(text);
      }
      if (token !== this.previewToken) return;
    } else {
      target.addClass("nf-plain");
      target.setText(text);
    }

    const terms = queryTerms(this.query);
    const first = terms.length ? highlightTree(target, terms) : null;
    if (first) first.scrollIntoView({ block: "center" });
    else this.previewEl.scrollTop = 0;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private select(i: number): void {
    if (!this.rows.length) return;
    const shown = Math.min(this.rows.length, MAX_ROWS);
    this.index = ((i % shown) + shown) % shown;
    this.updateSelection();
  }

  private next(step = 1): void {
    this.select(this.index + step);
  }

  private prev(step = 1): void {
    this.select(this.index - step);
  }

  private setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
    this.refresh(false);
  }

  private async openSelected(): Promise<void> {
    if (this.opening) return;
    const row = this.rows[this.index];
    if (!row) {
      this.close();
      return;
    }
    this.opening = true;
    const { file, line } = row;
    this.close();
    // Jump to the matching line so the hit is on screen, not just the note.
    await openNote(this.app, file, this.plugin.settings.openInNewTab, line ?? undefined);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private registerListeners(): void {
    const doc = this.modalEl.ownerDocument;
    const win = doc.defaultView ?? window;

    this.inputEl.addEventListener("input", () => this.setQuery(this.inputEl.value));

    const rowIndexOf = (evt: Event): number => {
      const target = (evt.target as Element | null)?.closest?.<HTMLElement>(".nf-list-row") ?? null;
      const i = target ? Number(target.dataset.index) : NaN;
      return Number.isInteger(i) && i >= 0 ? i : -1;
    };
    this.listEl.addEventListener("click", (evt) => {
      const i = rowIndexOf(evt);
      if (i < 0) return;
      evt.preventDefault();
      this.select(i);
      this.inputEl.focus();
    });
    this.listEl.addEventListener("dblclick", (evt) => {
      const i = rowIndexOf(evt);
      if (i < 0) return;
      evt.preventDefault();
      this.index = i;
      void this.openSelected();
    });

    const onKeyDown = (evt: KeyboardEvent) => this.handleKeyDown(evt);
    const onKeyUp = (evt: KeyboardEvent) => this.handleKeyUp(evt);
    const onBlur = () => this.heldModifiers.clear();
    win.addEventListener("keydown", onKeyDown, { capture: true });
    win.addEventListener("keyup", onKeyUp, { capture: true });
    win.addEventListener("blur", onBlur);
    this.renderComponent.register(() => {
      win.removeEventListener("keydown", onKeyDown, { capture: true });
      win.removeEventListener("keyup", onKeyUp, { capture: true });
      win.removeEventListener("blur", onBlur);
    });
  }

  private handleKeyDown(evt: KeyboardEvent): void {
    const swallow = () => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    const ctrl = evt.ctrlKey || evt.metaKey;

    switch (evt.key) {
      case "Tab":
        swallow();
        evt.shiftKey ? this.prev() : this.next();
        return;
      case "ArrowDown":
        swallow();
        this.next();
        return;
      case "ArrowUp":
        swallow();
        this.prev();
        return;
      case "PageDown":
        swallow();
        this.next(PAGE_STEP);
        return;
      case "PageUp":
        swallow();
        this.prev(PAGE_STEP);
        return;
      case "Enter":
        swallow();
        void this.openSelected();
        return;
      case "Escape":
        swallow();
        this.close();
        return;
    }

    if (ctrl && !evt.altKey) {
      const key = evt.key.toLowerCase();
      if (key === "n" || key === "j") {
        swallow();
        this.next();
        return;
      }
      if (key === "p" || key === "k") {
        swallow();
        this.prev();
        return;
      }
    }

    // Pressing the hotkey's own key again while its modifier is still held
    // steps through the list, like tapping Tab repeatedly during Alt+Tab.
    const modifierHeld = evt.altKey || evt.ctrlKey || evt.metaKey;
    if (modifierHeld && evt.key.length === 1 && this.heldModifiers.size) {
      swallow();
      evt.shiftKey ? this.prev() : this.next();
    }
  }

  private handleKeyUp(evt: KeyboardEvent): void {
    if (!this.heldModifiers.has(evt.key)) return;
    this.heldModifiers.delete(evt.key);
    if (!this.plugin.settings.releaseModifierToOpen) return;
    evt.preventDefault();
    evt.stopPropagation();
    void this.openSelected();
  }
}
