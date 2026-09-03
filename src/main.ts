import { Notice, Plugin } from "obsidian";
import { FlipModal } from "./flipModal";
import { t } from "./i18n";
import { collectNotes } from "./noteSource";
import { DEFAULT_SETTINGS, NoteFlipSettings, NoteFlipSettingTab, NoteSource } from "./settings";

const TRACKED_MODIFIERS = new Set(["Alt", "Control", "Meta"]);

export default class NoteFlipPlugin extends Plugin {
  settings: NoteFlipSettings = DEFAULT_SETTINGS;
  /** Modifier keys currently held down, so a hotkey can behave like Alt+Tab. */
  private readonly heldModifiers = new Set<string>();
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.trackModifiers();

    this.addCommand({
      id: "open",
      name: t("cmdOpen"),
      callback: () => this.openFlip(),
    });
    this.addCommand({
      id: "open-recent",
      name: t("cmdOpenRecent"),
      callback: () => this.openFlip("recent"),
    });
    this.addCommand({
      id: "open-tabs",
      name: t("cmdOpenTabs"),
      callback: () => this.openFlip("open"),
    });
    this.addCommand({
      id: "open-all",
      name: t("cmdOpenAll"),
      callback: () => this.openFlip("all"),
    });

    this.addSettingTab(new NoteFlipSettingTab(this.app, this));
    this.refreshRibbon();
  }

  openFlip(source: NoteSource = this.settings.source): void {
    const files = collectNotes(this.app, source, this.settings.maxCards);
    if (!files.length) {
      new Notice(t("noNotes"));
      return;
    }
    new FlipModal(this.app, this, files, new Set(this.heldModifiers)).open();
  }

  refreshRibbon(): void {
    if (this.settings.showRibbonIcon && !this.ribbonIconEl) {
      this.ribbonIconEl = this.addRibbonIcon("layers", t("ribbon"), () => this.openFlip());
    } else if (!this.settings.showRibbonIcon && this.ribbonIconEl) {
      this.ribbonIconEl.remove();
      this.ribbonIconEl = null;
    }
  }

  private trackModifiers(): void {
    this.registerDomEvent(
      window,
      "keydown",
      (evt) => {
        if (TRACKED_MODIFIERS.has(evt.key)) this.heldModifiers.add(evt.key);
      },
      { capture: true },
    );
    this.registerDomEvent(
      window,
      "keyup",
      (evt) => {
        if (TRACKED_MODIFIERS.has(evt.key)) this.heldModifiers.delete(evt.key);
      },
      { capture: true },
    );
    this.registerDomEvent(window, "blur", () => this.heldModifiers.clear());
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
