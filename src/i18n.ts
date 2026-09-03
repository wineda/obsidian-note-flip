const en = {
  cmdOpen: "Flip through notes (Flip 3D)",
  cmdOpenRecent: "Flip through recent notes",
  cmdOpenTabs: "Flip through open tabs",
  cmdOpenAll: "Flip through all notes",
  ribbon: "Flip through notes",
  noNotes: "No notes to flip through",
  noMatch: "No notes match",
  hintNext: "Next",
  hintPrev: "Previous",
  hintOpen: "Open",
  hintClose: "Close",
  hintFilter: "Type to filter",
  untitled: "Untitled",

  settingsSourceHeading: "Notes",
  settingsSource: "Which notes to show",
  settingsSourceDesc:
    "Recent: recently opened notes, padded with recently modified ones. Open tabs: notes open in the workspace. All: every note in the vault, newest first.",
  sourceRecent: "Recent notes",
  sourceOpen: "Open tabs",
  sourceAll: "All notes",
  settingsMaxCards: "Maximum number of cards",
  settingsMaxCardsDesc: "How many notes are loaded into the stack.",
  settingsStartOnPrevious: "Start on the previous note",
  settingsStartOnPreviousDesc:
    "Select the second card when opening, like Alt+Tab, so a quick press and release jumps to the previous note.",

  settingsBehaviorHeading: "Behavior",
  settingsReleaseToOpen: "Open when the modifier key is released",
  settingsReleaseToOpenDesc:
    "If the flip was triggered by a hotkey with Alt, Ctrl or Cmd, releasing that key opens the selected note (Alt+Tab style).",
  settingsOpenInNewTab: "Open in a new tab",
  settingsOpenInNewTabDesc:
    "Open the selected note in a new tab instead of the current one. Notes that are already open are focused either way.",
  settingsWheel: "Mouse wheel navigation",
  settingsWheelDesc: "Scroll the wheel over the stack to flip cards.",
  settingsTypeToFilter: "Type to filter",
  settingsTypeToFilterDesc: "Typing letters while the stack is open filters the cards by title and path.",

  settingsLookHeading: "Appearance",
  settingsTheme: "Card style",
  settingsThemeDesc: "Aero: Vista style blue glass. Obsidian: follow the current theme colors.",
  themeAero: "Aero glass",
  themeObsidian: "Obsidian theme",
  settingsVisibleDepth: "Visible cards in the stack",
  settingsVisibleDepthDesc: "Cards deeper than this are hidden until you flip to them.",
  settingsTilt: "Tilt angle",
  settingsTiltDesc: "Rotation of the cards around the vertical axis, in degrees.",
  settingsSpacing: "Spacing",
  settingsSpacingDesc: "Distance between cards in the stack.",
  settingsAnimation: "Animation duration",
  settingsAnimationDesc: "In milliseconds. Set to 0 to disable animation.",
  settingsReflection: "Reflection",
  settingsReflectionDesc: "Draw a faint mirror image below each card.",
  settingsHints: "Show keyboard hints",
  settingsHintsDesc: "Show the key legend at the bottom of the screen.",
  settingsRibbon: "Show ribbon icon",
  settingsRibbonDesc: "Add a button to the left ribbon that opens the stack.",

  settingsPreviewHeading: "Preview",
  settingsRenderMarkdown: "Render Markdown",
  settingsRenderMarkdownDesc: "Render the note preview as formatted Markdown instead of plain text.",
  settingsPreviewChars: "Preview length",
  settingsPreviewCharsDesc: "Number of characters of each note shown on the card.",
};

const ja: typeof en = {
  cmdOpen: "ノートをめくる (Flip 3D)",
  cmdOpenRecent: "最近のノートをめくる",
  cmdOpenTabs: "開いているタブをめくる",
  cmdOpenAll: "すべてのノートをめくる",
  ribbon: "ノートをめくる",
  noNotes: "めくれるノートがありません",
  noMatch: "一致するノートがありません",
  hintNext: "次へ",
  hintPrev: "前へ",
  hintOpen: "開く",
  hintClose: "閉じる",
  hintFilter: "文字入力で絞り込み",
  untitled: "無題",

  settingsSourceHeading: "ノート",
  settingsSource: "表示するノート",
  settingsSourceDesc:
    "最近: 最近開いたノート（足りない分は更新日時順で補完）。開いているタブ: ワークスペースで開いているノート。すべて: 保管庫内の全ノートを更新日時順に。",
  sourceRecent: "最近のノート",
  sourceOpen: "開いているタブ",
  sourceAll: "すべてのノート",
  settingsMaxCards: "カードの最大枚数",
  settingsMaxCardsDesc: "スタックに読み込むノートの数。",
  settingsStartOnPrevious: "前のノートを初期選択にする",
  settingsStartOnPreviousDesc:
    "Alt+Tab のように、開いた時点で 2 枚目を選択状態にします。すぐにキーを離すと直前のノートへ切り替わります。",

  settingsBehaviorHeading: "動作",
  settingsReleaseToOpen: "修飾キーを離したら開く",
  settingsReleaseToOpenDesc:
    "Alt / Ctrl / Cmd を含むホットキーで起動した場合、そのキーを離すと選択中のノートを開きます（Alt+Tab 風）。",
  settingsOpenInNewTab: "新しいタブで開く",
  settingsOpenInNewTabDesc:
    "現在のタブではなく新しいタブでノートを開きます。既に開いているノートはどちらの場合もそのタブにフォーカスします。",
  settingsWheel: "マウスホイールでめくる",
  settingsWheelDesc: "スタックの上でホイールを回すとカードをめくります。",
  settingsTypeToFilter: "文字入力で絞り込み",
  settingsTypeToFilterDesc: "スタック表示中に文字を打つと、タイトルとパスでカードを絞り込みます。",

  settingsLookHeading: "見た目",
  settingsTheme: "カードのスタイル",
  settingsThemeDesc: "Aero: Vista 風の青いガラス。Obsidian: 現在のテーマの配色に従います。",
  themeAero: "Aero ガラス",
  themeObsidian: "Obsidian テーマ",
  settingsVisibleDepth: "スタックに見える枚数",
  settingsVisibleDepthDesc: "これより奥のカードは、めくって近づくまで隠れます。",
  settingsTilt: "傾きの角度",
  settingsTiltDesc: "カードを縦軸まわりに回転させる角度（度）。",
  settingsSpacing: "カードの間隔",
  settingsSpacingDesc: "スタック内のカード同士の距離。",
  settingsAnimation: "アニメーション時間",
  settingsAnimationDesc: "ミリ秒。0 でアニメーションを無効にします。",
  settingsReflection: "反射",
  settingsReflectionDesc: "各カードの下に薄い鏡像を描きます。",
  settingsHints: "キー操作のヒントを表示",
  settingsHintsDesc: "画面下部にキー操作の凡例を表示します。",
  settingsRibbon: "リボンアイコンを表示",
  settingsRibbonDesc: "左のリボンにスタックを開くボタンを追加します。",

  settingsPreviewHeading: "プレビュー",
  settingsRenderMarkdown: "Markdown をレンダリング",
  settingsRenderMarkdownDesc: "プレビューをプレーンテキストではなく整形済み Markdown として表示します。",
  settingsPreviewChars: "プレビューの長さ",
  settingsPreviewCharsDesc: "カードに表示する各ノートの文字数。",
};

export type StringKey = keyof typeof en;

const tables: Record<string, typeof en> = { en, ja };

function currentLanguage(): string {
  try {
    return window.localStorage.getItem("language") ?? "en";
  } catch {
    return "en";
  }
}

export function t(key: StringKey): string {
  const table = tables[currentLanguage()] ?? en;
  return table[key] ?? en[key];
}
