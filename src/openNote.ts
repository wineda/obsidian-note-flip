import { App, MarkdownView, TFile } from "obsidian";

/**
 * Open a note the way the switcher expects: focus the tab that already shows
 * it, otherwise open it in the current tab or a new one. When `line` is
 * given (0-based), the editor scrolls to that line and puts the cursor there.
 */
export async function openNote(app: App, file: TFile, inNewTab: boolean, line?: number): Promise<void> {
  const { workspace } = app;
  const eState = line === undefined ? undefined : { line };
  const existing = workspace
    .getLeavesOfType("markdown")
    .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
  if (existing) {
    workspace.setActiveLeaf(existing, { focus: true });
    if (eState) existing.view.setEphemeralState(eState);
    return;
  }
  const leaf = workspace.getLeaf(inNewTab ? "tab" : false);
  await leaf.openFile(file, eState ? { eState } : undefined);
}
