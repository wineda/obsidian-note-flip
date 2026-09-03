import { App, MarkdownView, TFile } from "obsidian";
import type { NoteSource } from "./settings";

function isNote(file: unknown): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

function byModifiedDesc(a: TFile, b: TFile): number {
  return b.stat.mtime - a.stat.mtime;
}

/** Notes currently open in markdown leaves, in workspace order. */
export function openNotes(app: App): TFile[] {
  const files: TFile[] = [];
  app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file) files.push(view.file);
  });
  return files;
}

/** Recently opened notes, most recent first. */
export function recentNotes(app: App): TFile[] {
  const files: TFile[] = [];
  for (const path of app.workspace.getLastOpenFiles()) {
    const file = app.vault.getAbstractFileByPath(path);
    if (isNote(file)) files.push(file);
  }
  return files;
}

/** Every note in the vault, newest modification first. */
export function allNotes(app: App): TFile[] {
  return app.vault.getMarkdownFiles().slice().sort(byModifiedDesc);
}

/**
 * Build the ordered list of notes for the stack. The active note always
 * comes first so the stack starts from "where you are".
 */
export function collectNotes(app: App, source: NoteSource, max: number): TFile[] {
  const seen = new Set<string>();
  const result: TFile[] = [];
  const push = (file: TFile) => {
    if (result.length >= max || seen.has(file.path)) return;
    seen.add(file.path);
    result.push(file);
  };

  const active = app.workspace.getActiveFile();
  if (isNote(active)) push(active);

  switch (source) {
    case "open":
      openNotes(app).forEach(push);
      break;
    case "all":
      allNotes(app).forEach(push);
      break;
    case "recent":
    default:
      recentNotes(app).forEach(push);
      if (result.length < max) openNotes(app).forEach(push);
      if (result.length < max) allNotes(app).forEach(push);
      break;
  }

  return result;
}
