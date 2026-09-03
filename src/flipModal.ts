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
  previewEl: HTMLElement;
  rendered: boolean;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const WHEEL_THROTTLE_MS = 90;
const SWIPE_THRESHOLD_PX = 40;

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
  private opening = false;

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

    const title = chrome.createDiv({ cls: "nf-card-title" });
    setIcon(title.createSpan({ cls: "nf-card-icon" }), "file-text");
    title.createSpan({ cls: "nf-card-name", text: file.basename || t("untitled") });
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    const when = moment(file.stat.mtime).fromNow();
    title.createSpan({ cls: "nf-card-meta", text: folder ? `${folder} · ${when}` : when });

    const body = chrome.createDiv({ cls: "nf-card-body" });
    const previewEl = body.createDiv({ cls: "nf-card-preview markdown-rendered" });

    const card: Card = { file, el, previewEl, rendered: false };
    this.cardPool.set(file.path, card);

    el.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const i = this.cards.indexOf(card);
      if (i < 0) return;
      if (i === this.index) void this.openSelected();
      else this.select(i);
    });
    el.addEventListener("dblclick", (evt) => {
      evt.stopPropagation();
      const i = this.cards.indexOf(card);
      if (i < 0) return;
      this.index = i;
      void this.openSelected();
    });
    return card;
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
    this.cards.forEach((card, i) => {
      const d = (i - this.index + n) % n;
      const visible = d < depth;
      // Hidden cards park just behind the last visible one so that flipping
      // in either direction looks like a card coming from the back of the stack.
      card.el.style.setProperty("--d", String(Math.min(d, depth)));
      card.el.style.zIndex = String(n - d);
      card.el.toggleClass("nf-hidden", !visible);
      card.el.toggleClass("nf-front", d === 0);
      if (visible && !card.rendered) void this.renderCard(card);
    });
    this.counterEl.setText(n ? `${this.index + 1} / ${n}` : "0 / 0");
    this.queryEl.setText(this.query);
    this.queryEl.toggleClass("nf-visible", this.query.length > 0);
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

    win.addEventListener("keydown", onKeyDown, { capture: true });
    win.addEventListener("keyup", onKeyUp, { capture: true });
    win.addEventListener("blur", onBlur);
    this.renderComponent.register(() => {
      win.removeEventListener("keydown", onKeyDown, { capture: true });
      win.removeEventListener("keyup", onKeyUp, { capture: true });
      win.removeEventListener("blur", onBlur);
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
