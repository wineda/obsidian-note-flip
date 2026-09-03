import { App, PluginSettingTab, Setting } from "obsidian";
import type NoteFlipPlugin from "./main";
import { t } from "./i18n";

export type NoteSource = "recent" | "open" | "all";
export type CardTheme = "aero" | "obsidian";

export interface NoteFlipSettings {
  source: NoteSource;
  maxCards: number;
  startOnPrevious: boolean;

  releaseModifierToOpen: boolean;
  openInNewTab: boolean;
  wheelNavigation: boolean;
  typeToFilter: boolean;

  theme: CardTheme;
  visibleDepth: number;
  tiltDeg: number;
  spacing: number;
  animationMs: number;
  showReflection: boolean;
  showHints: boolean;
  showRibbonIcon: boolean;

  renderMarkdown: boolean;
  previewChars: number;
}

export const DEFAULT_SETTINGS: NoteFlipSettings = {
  source: "recent",
  maxCards: 12,
  startOnPrevious: true,

  releaseModifierToOpen: true,
  openInNewTab: false,
  wheelNavigation: true,
  typeToFilter: true,

  theme: "aero",
  visibleDepth: 6,
  tiltDeg: 28,
  spacing: 1,
  animationMs: 320,
  showReflection: true,
  showHints: true,
  showRibbonIcon: true,

  renderMarkdown: true,
  previewChars: 1500,
};

export class NoteFlipSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NoteFlipPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName(t("settingsSourceHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("settingsSource"))
      .setDesc(t("settingsSourceDesc"))
      .addDropdown((d) =>
        d
          .addOptions({
            recent: t("sourceRecent"),
            open: t("sourceOpen"),
            all: t("sourceAll"),
          })
          .setValue(s.source)
          .onChange(async (v) => {
            s.source = v as NoteSource;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsMaxCards"))
      .setDesc(t("settingsMaxCardsDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(2, 60, 1)
          .setValue(s.maxCards)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxCards = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsStartOnPrevious"))
      .setDesc(t("settingsStartOnPreviousDesc"))
      .addToggle((tg) =>
        tg.setValue(s.startOnPrevious).onChange(async (v) => {
          s.startOnPrevious = v;
          await save();
        }),
      );

    new Setting(containerEl).setName(t("settingsBehaviorHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("settingsReleaseToOpen"))
      .setDesc(t("settingsReleaseToOpenDesc"))
      .addToggle((tg) =>
        tg.setValue(s.releaseModifierToOpen).onChange(async (v) => {
          s.releaseModifierToOpen = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsOpenInNewTab"))
      .setDesc(t("settingsOpenInNewTabDesc"))
      .addToggle((tg) =>
        tg.setValue(s.openInNewTab).onChange(async (v) => {
          s.openInNewTab = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsWheel"))
      .setDesc(t("settingsWheelDesc"))
      .addToggle((tg) =>
        tg.setValue(s.wheelNavigation).onChange(async (v) => {
          s.wheelNavigation = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsTypeToFilter"))
      .setDesc(t("settingsTypeToFilterDesc"))
      .addToggle((tg) =>
        tg.setValue(s.typeToFilter).onChange(async (v) => {
          s.typeToFilter = v;
          await save();
        }),
      );

    new Setting(containerEl).setName(t("settingsLookHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("settingsTheme"))
      .setDesc(t("settingsThemeDesc"))
      .addDropdown((d) =>
        d
          .addOptions({ aero: t("themeAero"), obsidian: t("themeObsidian") })
          .setValue(s.theme)
          .onChange(async (v) => {
            s.theme = v as CardTheme;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsVisibleDepth"))
      .setDesc(t("settingsVisibleDepthDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(2, 12, 1)
          .setValue(s.visibleDepth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.visibleDepth = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsTilt"))
      .setDesc(t("settingsTiltDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(0, 50, 1)
          .setValue(s.tiltDeg)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.tiltDeg = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsSpacing"))
      .setDesc(t("settingsSpacingDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(0.5, 2, 0.1)
          .setValue(s.spacing)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.spacing = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsAnimation"))
      .setDesc(t("settingsAnimationDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(0, 1000, 20)
          .setValue(s.animationMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.animationMs = v;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settingsReflection"))
      .setDesc(t("settingsReflectionDesc"))
      .addToggle((tg) =>
        tg.setValue(s.showReflection).onChange(async (v) => {
          s.showReflection = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsHints"))
      .setDesc(t("settingsHintsDesc"))
      .addToggle((tg) =>
        tg.setValue(s.showHints).onChange(async (v) => {
          s.showHints = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsRibbon"))
      .setDesc(t("settingsRibbonDesc"))
      .addToggle((tg) =>
        tg.setValue(s.showRibbonIcon).onChange(async (v) => {
          s.showRibbonIcon = v;
          await save();
          this.plugin.refreshRibbon();
        }),
      );

    new Setting(containerEl).setName(t("settingsPreviewHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("settingsRenderMarkdown"))
      .setDesc(t("settingsRenderMarkdownDesc"))
      .addToggle((tg) =>
        tg.setValue(s.renderMarkdown).onChange(async (v) => {
          s.renderMarkdown = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingsPreviewChars"))
      .setDesc(t("settingsPreviewCharsDesc"))
      .addSlider((sl) =>
        sl
          .setLimits(200, 6000, 100)
          .setValue(s.previewChars)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.previewChars = v;
            await save();
          }),
      );
  }
}
