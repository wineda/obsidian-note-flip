import {
  App,
  Component,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Platform,
  TFile,
  moment,
  prepareFuzzySearch,
  setIcon,
} from "obsidian";
import type NoteFlipPlugin from "./main";
import { t } from "./i18n";

interface Card {
  file: TFile;
  el: HTMLElement;
  titleEl: HTMLElement;
  previewEl: HTMLElement;
  rendered: boolean;
}

/** A straight line on screen, given by its two end points. */
interface ScreenLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const WHEEL_THROTTLE_MS = 90;
const SWIPE_THRESHOLD_PX = 40;
const RESIZE_DEBOUNCE_MS = 60;
/** Two clicks closer than this in time and space count as a double click. */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 24;
/** Screen pixels kept free between a card's title bar and the card in front of it. */
const TITLE_GAP_PX = 8;
/** Screen space reserved above the stack and below it (reflection + HUD). */
const STACK_TOP_MARGIN_PX = 12;
const STACK_BOTTOM_RESERVE_MIN_PX = 80;
const STACK_BOTTOM_RESERVE_RATIO = 0.12;
const MIN_CARD_HEIGHT_PX = 160;
/** Fallbacks for when the stage's computed style cannot be read. */
const DEFAULT_PERSPECTIVE_PX = 1500;
const DEFAULT_TITLE_HEIGHT_PX = 36;

function lineY(line: ScreenLine, x: number): number {
  if (line.x2 === line.x1) return line.y1;
  return line.y1 + ((line.y2 - line.y1) * (x - line.x1)) / (line.x2 - line.x1);
}

/**
 * Full screen overlay that shows notes as a 3D stack of glass cards, in the
 * spirit of Windows Aero Flip 3D.
 */
export class FlipModal extends Modal {
  private readonly cardPool = new Map<string, Card>();
  private readonly renderComponent = new Component();
  private cards: Card[] = [];
  private index = 0;
  private query = "";
  private lastWheelAt = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private lastClickAt = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private opening = false;
  /**
   * Upward offset (in untransformed px) of a card at each depth 0..visibleDepth,
   * chosen so that every card's title bar stays clear of the card in front.
   * Null until the stage has been measured; recomputed on resize.
   */
  private depthOffsets: number[] | null = null;

  private stageEl!: HTMLElement;
  private counterEl!: HTMLElement;
  private queryEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  constructor(
    app: App,
    private readonly plugin: NoteFlipPlugin,
    private readonly files: TFile[],
    /** Modifier keys that were held down when the flip was triggered. */
    private readonly heldModifiers: Set<string>,
  ) {
    super(app);
  }

  onOpen(): void {
    const s = this.plugin.settings;
    this.renderComponent.load();

    this.containerEl.addClass("nf-container", `nf-theme-${s.theme}`);
    this.modalEl.addClass("nf-modal");
    this.modalEl.toggleClass("nf-reflect", s.showReflection);
    this.modalEl.style.setProperty("--nf-anim", `${s.animationMs}ms`);
    this.modalEl.style.setProperty("--nf-tilt", `${s.tiltDeg}deg`);
    this.modalEl.style.setProperty("--nf-spacing", String(s.spacing));
    this.modalEl.style.setProperty("--nf-depth", String(s.visibleDepth));

    this.contentEl.empty();
    this.stageEl = this.contentEl.createDiv({ cls: "nf-stage" });
    this.emptyEl = this.contentEl.createDiv({ cls: "nf-empty", text: t("noMatch") });
    this.buildHud();

    this.rebuildCards();
    this.index = s.startOnPrevious && this.cards.length > 1 ? 1 : 0;
    this.layout();

    // Cards start slightly below and transparent, then settle into place.
    this.stageEl.addClass("nf-enter");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.stageEl.removeClass("nf-enter"));
    });

    this.registerListeners();
  }

  onClose(): void {
    this.renderComponent.unload();
    this.cardPool.clear();
    this.cards = [];
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  private buildHud(): void {
    const hud = this.contentEl.createDiv({ cls: "nf-hud" });
    this.counterEl = hud.createDiv({ cls: "nf-hud-counter" });
    this.queryEl = hud.createDiv({ cls: "nf-hud-query" });

    if (!this.plugin.settings.showHints) return;
    const hints = hud.createDiv({ cls: "nf-hud-hints" });
    const addHint = (keys: string, label: string) => {
      const hint = hints.createSpan({ cls: "nf-hint" });
      hint.createEl("kbd", { text: keys });
      hint.createSpan({ text: label });
    };
    if (Platform.isMobile) {
      addHint("←→", `${t("hintPrev")} / ${t("hintNext")}`);
      addHint("Tap", t("hintOpen"));
    } else {
      addHint("Tab", t("hintNext"));
      addHint("Shift+Tab", t("hintPrev"));
      addHint("Enter", t("hintOpen"));
      addHint("Esc", t("hintClose"));
      if (this.plugin.settings.typeToFilter) addHint("A-Z", t("hintFilter"));
    }
  }

  private cardFor(file: TFile): Card {
    const existing = this.cardPool.get(file.path);
    if (existing) return existing;

    const el = createDiv({ cls: "nf-card" });
    const chrome = el.createDiv({ cls: "nf-card-chrome" });

    const titleEl = chrome.createDiv({ cls: "nf-card-title" });
    setIcon(titleEl.createSpan({ cls: "nf-card-icon" }), "file-text");
    titleEl.createSpan({ cls: "nf-card-name", text: file.basename || t("untitled") });
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    const when = moment(file.stat.mtime).fromNow();
    titleEl.createSpan({ cls: "nf-card-meta", text: folder ? `${folder} · ${when}` : when });

    const body = chrome.createDiv({ cls: "nf-card-body" });
    const previewEl = body.createDiv({ cls: "nf-card-preview markdown-rendered" });

    const card: Card = { file, el, titleEl, previewEl, rendered: false };
    this.cardPool.set(file.path, card);

    el.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.handleCardClick(card, evt);
    });
    // The click handler already handles double clicks by timing; this only
    // keeps the browser from selecting title text on the second click.
    el.addEventListener("dblclick", (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
    });
    return card;
  }

  /**
   * A single click brings the card to the front; a second click shortly after
   * at the same spot opens it. Double clicks are detected here rather than via
   * the `dblclick` event because the first click reshuffles the stack, so the
   * second click usually lands on a different card element.
   */
  private handleCardClick(card: Card, evt: MouseEvent): void {
    const now = Date.now();
    const isDouble =
      now - this.lastClickAt < DOUBLE_CLICK_MS &&
      Math.abs(evt.clientX - this.lastClickX) <= DOUBLE_CLICK_PX &&
      Math.abs(evt.clientY - this.lastClickY) <= DOUBLE_CLICK_PX;
    if (isDouble) {
      this.lastClickAt = 0;
      void this.openSelected();
      return;
    }
    this.lastClickAt = now;
    this.lastClickX = evt.clientX;
    this.lastClickY = evt.clientY;

    const i = this.cards.indexOf(card);
    if (i < 0) return;
    if (i !== this.index) {
      this.select(i);
      return;
    }
    // On touch devices a tap on the front card opens it, as the HUD promises.
    if (Platform.isMobile) void this.openSelected();
  }

  private async renderCard(card: Card): Promise<void> {
    card.rendered = true;
    const s = this.plugin.settings;
    let text: string;
    try {
      text = await this.app.vault.cachedRead(card.file);
    } catch {
      return;
    }
    text = text.replace(FRONTMATTER_RE, "").trimStart();
    if (text.length > s.previewChars) text = text.slice(0, s.previewChars) + "\n…";

    card.previewEl.empty();
    if (!s.renderMarkdown) {
      card.previewEl.addClass("nf-plain");
      card.previewEl.setText(text);
      return;
    }
    try {
      await MarkdownRenderer.render(this.app, text, card.previewEl, card.file.path, this.renderComponent);
    } catch {
      card.previewEl.setText(text);
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private filteredFiles(): TFile[] {
    if (!this.query) return this.files;
    const search = prepareFuzzySearch(this.query);
    return this.files
      .map((file) => ({ file, match: search(file.basename) ?? search(file.path) }))
      .filter((r) => r.match !== null)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
      .map((r) => r.file);
  }

  private rebuildCards(): void {
    const selectedPath = this.cards[this.index]?.file.path;
    const next = this.filteredFiles().map((f) => this.cardFor(f));

    for (const card of this.cards) {
      if (!next.includes(card)) card.el.detach();
    }
    for (const card of next) {
      if (card.el.parentElement !== this.stageEl) this.stageEl.appendChild(card.el);
    }
    this.cards = next;

    const keep = next.findIndex((c) => c.file.path === selectedPath);
    this.index = this.query ? 0 : Math.max(0, keep);
    this.emptyEl.toggleClass("nf-visible", next.length === 0);
  }

  private layout(): void {
    const n = this.cards.length;
    const depth = this.plugin.settings.visibleDepth;
    if (!this.depthOffsets) this.depthOffsets = this.computeDepthOffsets();
    const offsets = this.depthOffsets;
    this.cards.forEach((card, i) => {
      const d = (i - this.index + n) % n;
      const visible = d < depth;
      // Hidden cards park just behind the last visible one so that flipping
      // in either direction looks like a card coming from the back of the stack.
      const slot = Math.min(d, depth);
      card.el.style.setProperty("--d", String(slot));
      if (offsets) card.el.style.setProperty("--ty", `${-offsets[slot]}px`);
      else card.el.style.removeProperty("--ty");
      card.el.style.zIndex = String(n - d);
      card.el.toggleClass("nf-hidden", !visible);
      card.el.toggleClass("nf-front", d === 0);
      if (visible && !card.rendered) void this.renderCard(card);
    });
    this.counterEl.setText(n ? `${this.index + 1} / ${n}` : "0 / 0");
    this.queryEl.setText(this.query);
    this.queryEl.toggleClass("nf-visible", this.query.length > 0);
  }

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  /**
   * Measures the stage and works out, in untransformed pixels, how far up each
   * depth slot has to sit so that the title bar of every visible card is fully
   * visible above the card in front of it. The stack is then positioned (and,
   * if it would not fit, the cards shrunk) so that the whole cascade stays on
   * screen. Returns null when the stage cannot be measured yet.
   */
  private computeDepthOffsets(): number[] | null {
    const s = this.plugin.settings;
    const depth = s.visibleDepth;
    const sample = this.cards[0];
    const stage = this.stageEl;
    if (!sample || !stage.isConnected) return null;

    const modal = this.modalEl;
    const stageH = stage.clientHeight;
    const w = sample.el.offsetWidth;
    if (!stageH || !w) return null;

    // Measure the card at its stylesheet height and position; the height is
    // only overridden below when the cascade would otherwise run off the top
    // of the screen.
    modal.style.removeProperty("--nf-card-h");
    modal.style.removeProperty("--nf-left");
    let h = sample.el.offsetHeight;
    if (!h) return null;
    const titleH = sample.titleEl.offsetHeight || DEFAULT_TITLE_HEIGHT_PX;

    const stepX = w * 0.1 * s.spacing;
    const stepZ = 150 * s.spacing;
    modal.style.setProperty("--nf-x", `${stepX}px`);
    modal.style.setProperty("--nf-z", `${stepZ}px`);

    const stageStyle = getComputedStyle(stage);
    const perspective = parseFloat(stageStyle.perspective) || DEFAULT_PERSPECTIVE_PX;
    const [originX = "", originY = ""] = stageStyle.perspectiveOrigin.split(" ");
    const ox = parseFloat(originX) || 0;
    const oy = parseFloat(originY) || 0;

    // Card corners after rotateY around the card centre: the left edge comes
    // towards the viewer, the right edge recedes. Depth then pushes them back.
    const tilt = (s.tiltDeg * Math.PI) / 180;
    const halfW = w / 2;
    let cx = sample.el.offsetLeft + halfW;
    const edgeX = halfW * Math.cos(tilt);
    const edgeZ = halfW * Math.sin(tilt);
    const scaleAt = (z: number) => perspective / (perspective - z);
    const scaleLeft = (d: number) => scaleAt(edgeZ - d * stepZ);
    const scaleRight = (d: number) => scaleAt(-edgeZ - d * stepZ);
    const screenY = (y: number, scale: number) => oy + (y - oy) * scale;
    /** Screen line of the horizontal card edge that sits at untransformed `y`. */
    const edgeLine = (d: number, y: number): ScreenLine => {
      const sl = scaleLeft(d);
      const sr = scaleRight(d);
      return {
        x1: ox + (cx - edgeX + d * stepX - ox) * sl,
        y1: screenY(y, sl),
        x2: ox + (cx + edgeX + d * stepX - ox) * sr,
        y2: screenY(y, sr),
      };
    };

    /** Offsets for every depth slot given the front card's untransformed top. */
    const solve = (top: number): number[] => {
      const offsets = [0];
      for (let d = 1; d <= depth; d++) {
        const front = edgeLine(d - 1, top - offsets[d - 1]);
        // The gap to the front card's top edge is linear in the offset, so
        // sample it at two offsets and solve for the one that gives the margin.
        const gapAt = (dy: number, x: number) => lineY(front, x) - lineY(edgeLine(d, top - dy + titleH), x);
        const titleBottom = edgeLine(d, top + titleH);
        const checks = [titleBottom.x1];
        const xEnd = Math.min(titleBottom.x2, front.x2);
        if (xEnd > titleBottom.x1) checks.push(xEnd);
        let needed = offsets[d - 1];
        for (const x of checks) {
          const g0 = gapAt(0, x);
          const slope = gapAt(1, x) - g0;
          if (slope > 1e-6) needed = Math.max(needed, (TITLE_GAP_PX - g0) / slope);
        }
        offsets.push(needed);
      }
      return offsets;
    };

    // Centre the cascade horizontally: from the front card's left corner to
    // the deepest visible card's right corner. Projected x moves linearly with
    // the layout position, at the corner's own scale. When the stack is wider
    // than the stage the front card wins and keeps its left edge on screen.
    const frontScale = scaleLeft(0);
    const backScale = scaleRight(depth - 1);
    const xMin = ox + (cx - edgeX - ox) * frontScale;
    const xMax = ox + (cx + edgeX + (depth - 1) * stepX - ox) * backScale;
    let shiftX = (stage.clientWidth - xMin - xMax) / (frontScale + backScale);
    shiftX = Math.max(shiftX, (STACK_TOP_MARGIN_PX - xMin) / frontScale);
    cx += shiftX;
    modal.style.setProperty("--nf-left", `${sample.el.offsetLeft + shiftX}px`);

    const bottomReserve = Math.max(STACK_BOTTOM_RESERVE_MIN_PX, stageH * STACK_BOTTOM_RESERVE_RATIO);
    const available = stageH - STACK_TOP_MARGIN_PX - bottomReserve;
    let top = sample.el.offsetTop;
    let offsets = solve(top);

    // Slide the stack into the free band, shrinking the cards when the cascade
    // is taller than the band. The offsets grow as the stack moves up (the
    // front edges get steeper), so use a secant step on the measured response
    // rather than assuming the stack moves 1:1 with the front card.
    let previous: { top: number; stackTop: number } | null = null;
    for (let iter = 0; iter < 16; iter++) {
      let stackTop = Infinity;
      let stackTopScale = frontScale;
      for (let d = 0; d < depth; d++) {
        const y = screenY(top - offsets[d], scaleLeft(d));
        if (y < stackTop) {
          stackTop = y;
          stackTopScale = scaleLeft(d);
        }
      }
      const stackBottom = screenY(top + h, frontScale);
      const height = stackBottom - stackTop;
      if (height > available + 0.5 && h > MIN_CARD_HEIGHT_PX) {
        const rise = height - h * frontScale;
        h = Math.max(MIN_CARD_HEIGHT_PX, (available - rise) / frontScale);
        modal.style.setProperty("--nf-card-h", `${h}px`);
        offsets = solve(top);
        previous = null;
        continue;
      }
      const wantedTop = STACK_TOP_MARGIN_PX + Math.max(0, available - height) / 2;
      const error = wantedTop - stackTop;
      if (Math.abs(error) < 0.5) break;
      let gain = stackTopScale;
      if (previous && previous.top !== top) {
        const measured = (stackTop - previous.stackTop) / (top - previous.top);
        if (measured > 0.1) gain = measured;
      }
      previous = { top, stackTop };
      top += error / gain;
      offsets = solve(top);
    }
    modal.style.setProperty("--nf-top", `${top}px`);
    return offsets;
  }

  private select(i: number): void {
    if (!this.cards.length) return;
    this.index = ((i % this.cards.length) + this.cards.length) % this.cards.length;
    this.layout();
  }

  private next(): void {
    this.select(this.index + 1);
  }

  private prev(): void {
    this.select(this.index - 1);
  }

  private setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.rebuildCards();
    this.layout();
  }

  private async openSelected(): Promise<void> {
    if (this.opening) return;
    const card = this.cards[this.index];
    if (!card) {
      this.close();
      return;
    }
    this.opening = true;
    const file = card.file;
    const { workspace } = this.app;

    const existing = workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    this.close();
    if (existing) {
      workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    const leaf = workspace.getLeaf(this.plugin.settings.openInNewTab ? "tab" : false);
    await leaf.openFile(file);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private registerListeners(): void {
    const s = this.plugin.settings;
    const doc = this.modalEl.ownerDocument;
    const win = doc.defaultView ?? window;

    const onKeyDown = (evt: KeyboardEvent) => this.handleKeyDown(evt);
    const onKeyUp = (evt: KeyboardEvent) => this.handleKeyUp(evt);
    const onBlur = () => this.heldModifiers.clear();

    let resizeTimer = 0;
    const onResize = () => {
      win.clearTimeout(resizeTimer);
      resizeTimer = win.setTimeout(() => {
        resizeTimer = 0;
        this.depthOffsets = null;
        this.layout();
      }, RESIZE_DEBOUNCE_MS);
    };

    win.addEventListener("keydown", onKeyDown, { capture: true });
    win.addEventListener("keyup", onKeyUp, { capture: true });
    win.addEventListener("blur", onBlur);
    win.addEventListener("resize", onResize);
    this.renderComponent.register(() => {
      win.removeEventListener("keydown", onKeyDown, { capture: true });
      win.removeEventListener("keyup", onKeyUp, { capture: true });
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("resize", onResize);
      win.clearTimeout(resizeTimer);
    });

    if (s.wheelNavigation) {
      const onWheel = (evt: WheelEvent) => {
        evt.preventDefault();
        const now = Date.now();
        if (now - this.lastWheelAt < WHEEL_THROTTLE_MS) return;
        this.lastWheelAt = now;
        const delta = Math.abs(evt.deltaY) >= Math.abs(evt.deltaX) ? evt.deltaY : evt.deltaX;
        if (delta > 0) this.next();
        else if (delta < 0) this.prev();
      };
      this.modalEl.addEventListener("wheel", onWheel, { passive: false });
      this.renderComponent.register(() => this.modalEl.removeEventListener("wheel", onWheel));
    }

    // Clicking the empty background closes the stack, like clicking the desktop.
    this.stageEl.addEventListener("click", () => this.close());

    this.stageEl.addEventListener(
      "touchstart",
      (evt) => {
        const touch = evt.touches[0];
        if (!touch) return;
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
      },
      { passive: true },
    );
    this.stageEl.addEventListener(
      "touchend",
      (evt) => {
        const touch = evt.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - this.touchStartX;
        const dy = touch.clientY - this.touchStartY;
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
        if (dx < 0) this.next();
        else this.prev();
      },
      { passive: true },
    );
  }

  private handleKeyDown(evt: KeyboardEvent): void {
    const s = this.plugin.settings;
    const swallow = () => {
      evt.preventDefault();
      evt.stopPropagation();
    };

    switch (evt.key) {
      case "Tab":
        swallow();
        evt.shiftKey ? this.prev() : this.next();
        return;
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
        swallow();
        this.next();
        return;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        swallow();
        this.prev();
        return;
      case "Home":
        swallow();
        this.select(0);
        return;
      case "End":
        swallow();
        this.select(this.cards.length - 1);
        return;
      case "Enter":
        swallow();
        void this.openSelected();
        return;
      case "Escape":
        swallow();
        this.close();
        return;
      case "Backspace":
        if (this.query) {
          swallow();
          this.setQuery(this.query.slice(0, -1));
        }
        return;
    }

    const printable = evt.key.length === 1;
    if (!printable) return;

    // Pressing the hotkey's own key again while its modifier is still held
    // steps through the stack, like tapping Tab repeatedly during Alt+Tab.
    const modifierHeld = evt.altKey || evt.ctrlKey || evt.metaKey;
    if (modifierHeld) {
      if (this.heldModifiers.size) {
        swallow();
        evt.shiftKey ? this.prev() : this.next();
      }
      return;
    }

    if (evt.key === " " && !this.query) {
      swallow();
      evt.shiftKey ? this.prev() : this.next();
      return;
    }

    if (s.typeToFilter) {
      swallow();
      this.setQuery(this.query + evt.key);
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
