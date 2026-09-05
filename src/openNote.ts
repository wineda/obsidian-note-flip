import { App, MarkdownView, TFile } from "obsidian";

/**
 * Open a note the way the switcher expects: focus the tab that already shows
 * it, otherwise open it in the current tab or a new one.
 */
export async function openNote(app: App, file: TFile, inNewTab: boolean): Promise<void> {
  const { workspace } = app;
  const existing = workspace
    .getLeavesOfType("markdown")
    .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
  if (existing) {
    workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
  const leaf = workspace.getLeaf(inNewTab ? "tab" : false);
  await leaf.openFile(file);
}
