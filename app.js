const STORAGE_KEY = "dark-nine-note-v5";
const APP_FILE_ID = "dark-nine-note";
const LAYOUT_ID = "theme-nine-dive";
const SAVE_FILE_VERSION = 2;
const DEFAULT_FILE_TITLE = "dark-nine-note";
const MAX_ROWS = 9;
const MAX_TEXT_LENGTH = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const POSITION_LABELS = ["左上", "上", "右上", "左", "まん中", "右", "左下", "下", "右下"];

const HINT_LOCKED = "埋まらなくても「これでOK」で先へ進めるよ。";
const HINT_UNLOCKED = "書いてあるマスを押すと、その中へ潜れる。";

const emptyDive = () => ({ open: false, rows: [""] });
const defaultState = () => ({
  theme: "",
  cells: Array.from({ length: 9 }, () => ""),
  unlocked: false,
  dives: Array.from({ length: 9 }, emptyDive),
});

class OldVersionFileError extends Error {}

let state = loadState();

const themeInput = document.querySelector("#themeInput");
const entryGrid = document.querySelector("#entryGrid");
const sparkleLayer = document.querySelector("#sparkleLayer");
const entryHint = document.querySelector("#entryHint");
const okButton = document.querySelector("#okButton");
const diveLead = document.querySelector("#diveLead");
const diveField = document.querySelector("#diveField");
const copyAllButton = document.querySelector("#copyAllButton");
const saveFileButton = document.querySelector("#saveFileButton");
const openFileButton = document.querySelector("#openFileButton");
const openFileInput = document.querySelector("#openFileInput");
const resetButton = document.querySelector("#resetButton");
const statusText = document.querySelector("#statusText");

render();

/* ---------- 「≡」メニュー（ふだんは隠しておく） ---------- */

function setMenu(toggle, menu, open) {
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}

function closeAllMenus(except = null) {
  document.querySelectorAll(".menu-button[aria-expanded='true']").forEach((toggle) => {
    const menu = document.getElementById(toggle.getAttribute("aria-controls"));
    if (menu && menu !== except) setMenu(toggle, menu, false);
  });
}

function wireMenu(toggle, menu) {
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    closeAllMenus(menu);
    setMenu(toggle, menu, open);
    if (open) menu.querySelector("button")?.focus();
  });
  // 項目を選んだら閉じて、フォーカスは「≡」に戻す（別の場所へ移した項目はそちらを優先）
  menu.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-item")) return;
    setMenu(toggle, menu, false);
    setTimeout(() => {
      const active = document.activeElement;
      const focusLost = !active || active === document.body || menu.contains(active);
      if (focusLost && toggle.isConnected) toggle.focus();
    }, 0);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setMenu(toggle, menu, false);
    toggle.focus();
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrap")) closeAllMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllMenus();
});

wireMenu(document.querySelector("#mainMenuButton"), document.querySelector("#mainMenu"));

themeInput.addEventListener("input", () => {
  state.theme = themeInput.value;
  saveState();
});

themeInput.addEventListener("keydown", (event) => {
  if (!isPlainEnter(event)) return;
  event.preventDefault();
  focusKey("cell-0");
});

okButton.addEventListener("click", () => {
  unlock();
});

copyAllButton.addEventListener("click", () => {
  copyText(noteToText(), "ノート全体をテキストでコピーしました。");
});

saveFileButton.addEventListener("click", () => {
  try {
    downloadSaveFile();
  } catch {
    statusText.textContent = "保存ファイルを書き出せませんでした。";
  }
});

openFileButton.addEventListener("click", () => {
  openFileInput.click();
});

openFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    statusText.textContent = "このファイルは大きすぎて開けませんでした。";
    return;
  }

  try {
    const text = await file.text();
    state = stateFromSaveFile(JSON.parse(text));
    saveState();
    render();
    statusText.textContent = `${file.name} を開きました。`;
  } catch (error) {
    statusText.textContent = error instanceof OldVersionFileError
      ? "これは前の版（v3/v4）のノートのファイルなので、この版では開けません。"
      : "このファイルは開けませんでした。";
  }
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("すべての入力が消えて、白紙に戻ります。よろしいですか？");
  if (!confirmed) return;

  state = defaultState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 保存できない環境でも、画面は白紙に戻す
  }
  render();
  statusText.textContent = "";
});

/* ---------- 描画 ---------- */

function render() {
  themeInput.value = state.theme;
  renderEntry();
  renderDives();
}

function renderEntry() {
  entryGrid.replaceChildren();
  state.cells.forEach((_, index) => {
    entryGrid.append(entryCell(index));
  });
  renderEntryFoot();
}

function renderEntryFoot() {
  okButton.hidden = state.unlocked;
  entryHint.textContent = state.unlocked ? HINT_UNLOCKED : HINT_LOCKED;
}

function entryCell(index) {
  const canDive = state.unlocked && state.cells[index].trim() !== "";
  return canDive ? wordButton(index) : cellTextarea(index);
}

// 9マスのうち1つだけ作り直す（ほかの入力欄や深掘り欄にはさわらない）
function refreshEntryCell(index) {
  const current = entryGrid.children[index];
  if (!current || current.contains(document.activeElement)) return;
  const isButton = current.matches(".cell-word");
  const shouldBeButton = state.unlocked && state.cells[index].trim() !== "";
  if (isButton !== shouldBeButton || isButton) {
    current.replaceWith(entryCell(index));
  }
}

function refreshEntryCells() {
  state.cells.forEach((_, index) => refreshEntryCell(index));
}

function cellTextarea(index) {
  const cell = document.createElement("label");
  cell.className = "cell";
  cell.classList.toggle("cell--waiting", state.unlocked);

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.spellcheck = false;
  textarea.value = state.cells[index];
  textarea.dataset.key = `cell-${index}`;
  textarea.setAttribute("aria-label", `${POSITION_LABELS[index]}のマス`);

  textarea.maxLength = MAX_TEXT_LENGTH;

  textarea.addEventListener("input", (event) => {
    // 9マスは1つの言葉の場所なので、貼り付けなどで入った改行は空白にする
    if (!event.isComposing && /[\r\n]/.test(textarea.value)) {
      const caret = textarea.selectionStart;
      textarea.value = textarea.value.replace(/\r?\n/g, " ");
      textarea.setSelectionRange(caret, caret);
    }
    state.cells[index] = textarea.value;
    saveState();
    if (!event.isComposing) checkAllFilled();
  });

  textarea.addEventListener("compositionend", () => {
    checkAllFilled();
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); // Shift＋Enterでも改行は入れない
    if (!isPlainEnter(event)) return;
    if (index < 8) {
      focusKey(`cell-${index + 1}`);
    } else {
      textarea.blur();
    }
  });

  textarea.addEventListener("blur", () => {
    // 書いている途中のマスは、離れたときにはじめて「押せるマス」に変える
    setTimeout(() => {
      checkAllFilled();
      refreshEntryCell(index);
    }, 0);
  });

  cell.append(textarea);
  return cell;
}

function wordButton(index) {
  const dive = state.dives[index];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cell cell-word";
  button.dataset.key = `cell-${index}`;
  button.setAttribute("aria-expanded", String(dive.open));
  button.setAttribute("aria-controls", `dive-${index}`);

  const text = document.createElement("span");
  text.className = "cell-word-text";
  text.textContent = state.cells[index];
  button.append(text);

  if (!dive.open && hasRows(dive)) {
    const mark = document.createElement("span");
    mark.className = "dive-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "+";
    button.append(mark);
    button.setAttribute("aria-label", `${state.cells[index]}（潜って書いた跡あり）`);
  }

  button.addEventListener("click", () => toggleDive(index));
  return button;
}

function renderDives() {
  diveField.replaceChildren();
  const openIndices = state.dives
    .map((dive, index) => (dive.open ? index : -1))
    .filter((index) => index !== -1);

  diveLead.hidden = openIndices.length === 0;

  openIndices.forEach((index) => {
    diveField.append(divePanel(index));
  });
}

function divePanel(index) {
  const dive = state.dives[index];
  const panel = document.createElement("section");
  panel.className = "dive-panel";
  panel.id = `dive-${index}`;
  // PCでは9マスと同じ位置に並べる（開いていない場所は空けておく）
  panel.style.gridColumn = String((index % 3) + 1);
  panel.style.gridRow = String(Math.floor(index / 3) + 1);

  const header = document.createElement("div");
  header.className = "dive-header";

  const word = document.createElement("input");
  word.type = "text";
  word.className = "dive-word";
  word.value = state.cells[index];
  word.placeholder = "（言葉が空です）";
  word.spellcheck = false;
  word.dataset.key = `word-${index}`;
  word.setAttribute("aria-label", `${POSITION_LABELS[index]}のマスの言葉`);
  word.maxLength = MAX_TEXT_LENGTH;
  word.addEventListener("input", () => {
    state.cells[index] = word.value;
    saveState();
    refreshEntryCell(index);
    // 読み上げ用の行の名前も、新しい言葉に合わせる
    panel.querySelectorAll(".row-input").forEach((input, rowIndex) => {
      input.setAttribute("aria-label", `${word.value || POSITION_LABELS[index]}の${rowIndex + 1}行目`);
    });
  });
  word.addEventListener("keydown", (event) => {
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    focusRow(index, 0);
  });

  const count = document.createElement("span");
  count.className = "dive-count";
  count.textContent = `${dive.rows.length}/${MAX_ROWS}`;

  // コピー・閉じるは「≡」の中にしまう
  const menuWrap = document.createElement("div");
  menuWrap.className = "menu-wrap dive-menu-wrap";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "menu-button";
  toggle.setAttribute("aria-label", `${POSITION_LABELS[index]}のマスのメニュー`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", `dive-menu-${index}`);
  toggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12" /></svg>';

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.id = `dive-menu-${index}`;
  menu.hidden = true;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "menu-item";
  copy.textContent = "コピー";
  copy.addEventListener("click", () => {
    copyText(diveToText(index), "このマスをテキストでコピーしました。");
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "menu-item";
  close.textContent = "閉じる";
  close.addEventListener("click", () => {
    dive.open = false;
    saveState();
    render();
    focusKey(`cell-${index}`);
  });

  menu.append(copy, close);
  menuWrap.append(toggle, menu);
  wireMenu(toggle, menu);

  header.append(word, count, menuWrap);

  const rows = document.createElement("div");
  rows.className = "dive-rows";
  dive.rows.forEach((value, rowIndex) => {
    rows.append(diveRow(index, rowIndex, value));
  });

  const foot = document.createElement("div");
  foot.className = "dive-foot";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "dive-step dive-add";
  add.textContent = "+";
  add.setAttribute("aria-label", "行を足す");
  add.hidden = dive.rows.length >= MAX_ROWS;
  add.addEventListener("click", () => {
    const last = dive.rows.length - 1;
    if (dive.rows[last].trim() === "") {
      focusRow(index, last);
      return;
    }
    addRow(index, last);
  });

  // 最後の行だけ消せる
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "dive-step dive-remove";
  remove.textContent = "−";
  remove.setAttribute("aria-label", "最後の行を消す");
  remove.hidden = dive.rows.length <= 1;
  remove.addEventListener("click", () => {
    const rowsNow = state.dives[index].rows;
    if (rowsNow.length <= 1) return;
    removeRow(index, rowsNow.length - 1);
  });

  foot.append(add, remove);
  panel.append(header, rows, foot);
  return panel;
}

function diveRow(index, rowIndex, value) {
  const row = document.createElement("div");
  row.className = "dive-row";

  const number = document.createElement("span");
  number.className = "row-number";
  number.setAttribute("aria-hidden", "true");
  number.textContent = String(rowIndex + 1).padStart(2, "0");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "row-input";
  input.value = value;
  input.maxLength = MAX_TEXT_LENGTH;
  input.spellcheck = false;
  input.dataset.key = `row-${index}-${rowIndex}`;
  input.setAttribute("aria-label", `${state.cells[index] || POSITION_LABELS[index]}の${rowIndex + 1}行目`);

  input.addEventListener("input", () => {
    state.dives[index].rows[rowIndex] = input.value;
    saveState();
  });

  input.addEventListener("keydown", (event) => {
    if (isPlainEnter(event)) {
      event.preventDefault();
      if (input.value.trim() === "") return;
      if (state.dives[index].rows.length >= MAX_ROWS) {
        statusText.textContent = `ひとつのマスに書けるのは${MAX_ROWS}行までです。`;
        return;
      }
      addRow(index, rowIndex);
      return;
    }

    if (event.key === "Backspace" && !event.isComposing && input.value === "" &&
        state.dives[index].rows.length > 1) {
      event.preventDefault();
      removeRow(index, rowIndex);
    }
  });

  row.append(number, input);
  return row;
}

/* ---------- 動き ---------- */

function unlock() {
  if (state.unlocked) return;
  const fromButton = document.activeElement === okButton;
  state.unlocked = true;
  saveState();
  // 書いている途中のマスはそのまま。ほかのマスだけ「押せるマス」に変える
  refreshEntryCells();
  renderEntryFoot();
  if (fromButton) {
    entryGrid.querySelector(".cell-word, textarea")?.focus({ preventScroll: true });
  }
  showSparkles();
}

function checkAllFilled() {
  if (!state.unlocked && isAllFilled()) unlock();
}

function toggleDive(index) {
  if (!state.unlocked || state.cells[index].trim() === "") return;
  const dive = state.dives[index];
  dive.open = !dive.open;
  if (!dive.rows.length) dive.rows = [""];
  saveState();
  render();
  if (dive.open) {
    focusRow(index, dive.rows.length - 1);
  } else {
    focusKey(`cell-${index}`);
  }
}

function addRow(index, afterRow) {
  const rows = state.dives[index].rows;
  if (rows.length >= MAX_ROWS) return;
  rows.splice(afterRow + 1, 0, "");
  saveState();
  renderDives();
  focusRow(index, afterRow + 1);
  statusText.textContent = "";
}

function removeRow(index, rowIndex) {
  const rows = state.dives[index].rows;
  rows.splice(rowIndex, 1);
  saveState();
  renderDives();
  refreshEntryCell(index);
  focusRow(index, Math.max(rowIndex - 1, 0), true);
  statusText.textContent = "";
}

function showSparkles() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sparkles = document.createElement("span");
  sparkles.className = "completion-sparkles";
  for (let i = 0; i < 8; i++) {
    const star = document.createElement("span");
    star.textContent = "✦";
    sparkles.append(star);
  }
  sparkles.addEventListener("animationend", () => sparkles.remove(), { once: true });
  sparkleLayer.append(sparkles);
}

/* ---------- 小さな道具 ---------- */

function isPlainEnter(event) {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey &&
    !event.metaKey && !event.isComposing && event.keyCode !== 229;
}

function isAllFilled() {
  return state.cells.every((cell) => cell.trim() !== "");
}

function hasRows(dive) {
  return dive.rows.some((row) => row.trim() !== "");
}

function focusKey(key, selection = null) {
  const element = document.querySelector(`[data-key="${key}"]`);
  if (!element) return;
  element.focus();
  if (selection && typeof element.setSelectionRange === "function") {
    try {
      element.setSelectionRange(...selection);
    } catch {
      // 選択位置を戻せない要素は、そのまま
    }
  }
}

function focusRow(index, rowIndex, toEnd = false) {
  const key = `row-${index}-${rowIndex}`;
  const element = document.querySelector(`[data-key="${key}"]`);
  if (!element) return;
  element.focus();
  if (toEnd) {
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }
}

/* ---------- テキストで書き出す（AIでもメモ帳でも、どこにでも貼れる形） ---------- */

function filledRows(index) {
  return state.dives[index].rows.map((row) => row.trim()).filter(Boolean);
}

function themeLine() {
  const theme = state.theme.trim();
  return theme ? `テーマ：${theme}` : "テーマ：（なし）";
}

function noteToText() {
  const lines = [themeLine(), "", "■ 9マス"];
  state.cells.forEach((cell, index) => {
    lines.push(`${index + 1}. ${cell.trim() || "（空）"}`);
  });

  const dived = state.cells
    .map((_, index) => index)
    .filter((index) => filledRows(index).length > 0);

  if (dived.length) {
    lines.push("", "■ 潜ったところ");
    dived.forEach((index, order) => {
      if (order > 0) lines.push("");
      lines.push(`【${state.cells[index].trim() || "（空のマス）"}】`);
      filledRows(index).forEach((row) => lines.push(`- ${row}`));
    });
  }
  return lines.join("\n");
}

function diveToText(index) {
  const lines = [themeLine(), "", `【${state.cells[index].trim() || "（空のマス）"}】`];
  const rows = filledRows(index);
  if (rows.length) {
    rows.forEach((row) => lines.push(`- ${row}`));
  } else {
    lines.push("（まだ何も書いていません）");
  }
  return lines.join("\n");
}

async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    statusText.textContent = doneMessage;
  } catch {
    statusText.textContent = "コピーできませんでした。ブラウザがコピーを許可していないかもしれません。";
  }
}

/* ---------- 保存・読み込み ---------- */

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ブラウザが保存を許していないときは、画面の中だけで続ける
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function downloadSaveFile() {
  const payload = {
    app: APP_FILE_ID,
    layout: LAYOUT_ID,
    version: SAVE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    title: state.theme.trim() || state.cells.find((value) => value.trim()) || DEFAULT_FILE_TITLE,
    theme: "crystal-cave",
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileNameBase(payload.title)}.nine-note.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  statusText.textContent = "保存ファイルを書き出しました。";
}

function stateFromSaveFile(value) {
  if (value?.app === APP_FILE_ID && value.layout === LAYOUT_ID) {
    if (value.version !== SAVE_FILE_VERSION) throw new Error("Unknown version");
    return normalizeState(value.state);
  }
  // v3/v4 のファイル（中心の9マス＋周りの8つ）は形が違うので開かない
  if (value?.app === APP_FILE_ID || value?.app === "mandala-note" || Array.isArray(value?.core)) {
    throw new OldVersionFileError();
  }
  throw new Error("Invalid save file");
}

// 形がおかしいファイルは、今のノートを置き換えずに断る
function normalizeState(raw) {
  const isText = (value) => typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
  const fail = () => { throw new Error("Invalid state"); };

  if (!raw || typeof raw !== "object") fail();
  if (!isText(raw.theme)) fail();
  if (!Array.isArray(raw.cells) || raw.cells.length !== 9 || !raw.cells.every(isText)) fail();
  if (typeof raw.unlocked !== "boolean") fail();
  if (!Array.isArray(raw.dives) || raw.dives.length !== 9) fail();

  const dives = raw.dives.map((dive) => {
    if (!dive || typeof dive !== "object" || typeof dive.open !== "boolean") fail();
    if (!Array.isArray(dive.rows) || dive.rows.length < 1 || dive.rows.length > MAX_ROWS ||
        !dive.rows.every(isText)) fail();
    // まだ✨が出ていないノートでは、深掘り欄は開かない
    return { open: raw.unlocked && dive.open, rows: [...dive.rows] };
  });

  return {
    theme: raw.theme,
    cells: [...raw.cells],
    unlocked: raw.unlocked,
    dives,
  };
}

function fileNameBase(value) {
  const base = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 36);
  return base || DEFAULT_FILE_TITLE;
}
