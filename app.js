const STORAGE_KEY = "dark-nine-note-v3";
const APP_FILE_ID = "dark-nine-note";
const DEFAULT_FILE_TITLE = "dark-nine-note";
const SAVE_FILE_VERSION = 1;
const HISTORY_LIMIT = 100;
const EDIT_GROUP_MS = 800;
const CENTER_INDEX = 4;
const OUTER_CORE_INDICES = [0, 1, 2, 3, 5, 6, 7, 8];
const OUTER_LABELS = ["左上", "上", "右上", "左", "右", "左下", "下", "右下"];
const EMPTY_CELLS = () => Array.from({ length: 9 }, () => "");

const defaultState = () => ({
  core: EMPTY_CELLS(),
  expanded: false,
  outer: Array.from({ length: 8 }, () => EMPTY_CELLS()),
  lastExpandedFrom: Array.from({ length: 8 }, () => ""),
});

let state = loadState();
let storageAvailable = true;
const undoStack = [];
const redoStack = [];
let lastEdit = null;

const field = document.querySelector("#mandalaField");
const coreGrid = document.querySelector("#coreGrid");
const expandButton = document.querySelector("#expandButton");
const saveFileButton = document.querySelector("#saveFileButton");
const openFileButton = document.querySelector("#openFileButton");
const openFileInput = document.querySelector("#openFileInput");
const resetButton = document.querySelector("#resetButton");
const statusText = document.querySelector("#statusText");
const template = document.querySelector("#cellTemplate");
const outerPanels = [];
const celebratedBoards = new Set();

markCompletedBoards();
render();

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      !(event.ctrlKey || event.metaKey) || event.altKey) return;

  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  if (key === "y" && event.shiftKey) return;

  event.preventDefault();
  const redo = key === "y" || event.shiftKey;
  restoreHistory(redo ? redoStack : undoStack, redo ? undoStack : redoStack);
});

expandButton.addEventListener("click", () => {
  expandOuter();
  statusText.textContent = "";
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

  try {
    const text = await file.text();
    const next = stateFromSaveFile(JSON.parse(text));
    rememberChange();
    state = next;
    markCompletedBoards();
    saveState();
    render();
    statusText.textContent = `${file.name} を開きました。`;
  } catch {
    statusText.textContent = "このファイルは開けませんでした。";
  }
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("すべての入力を消して、白紙に戻します。");
  if (!confirmed) return;

  rememberChange();
  state = defaultState();
  celebratedBoards.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    storageAvailable = false;
  }
  render();
  statusText.textContent = "";
});

function render() {
  field.classList.toggle("mandala-field--expanded", state.expanded);
  field.classList.toggle("mandala-field--collapsed", !state.expanded);
  expandButton.hidden = state.expanded;

  renderGrid(coreGrid, state.core, {
    labelPrefix: "中心の9マス",
  });

  field.querySelectorAll(".outer-panel").forEach((panel) => panel.remove());
  outerPanels.length = 0;

  if (!state.expanded) {
    return;
  }

  state.outer.forEach((cells, outerIndex) => {
    const panel = document.createElement("section");
    panel.className = "mandala-panel outer-panel";
    panel.dataset.position = String(outerIndex);
    panel.setAttribute("aria-label", `${OUTER_LABELS[outerIndex]}のマンダラ`);

    const label = document.createElement("div");
    label.className = "panel-label";
    label.textContent = state.outer[outerIndex][CENTER_INDEX] || OUTER_LABELS[outerIndex];

    const grid = document.createElement("div");
    grid.className = "mandala-grid";

    panel.append(label, grid);
    field.append(panel);

    const inputs = renderGrid(grid, cells, {
      labelPrefix: `${OUTER_LABELS[outerIndex]}の9マス`,
      readOnlyCenter: true,
    });
    outerPanels.push({ grid, label, center: inputs[CENTER_INDEX] });
  });
}

function renderGrid(grid, cells, options) {
  grid.replaceChildren();

  return cells.map((value, index) => {
    const fragment = template.content.cloneNode(true);
    const cell = fragment.querySelector(".cell");
    const screenReaderText = fragment.querySelector(".sr-only");
    const textarea = fragment.querySelector("textarea");
    const isCenter = index === CENTER_INDEX;

    cell.classList.toggle("cell--center", isCenter);
    cell.classList.toggle("cell--seed", options.readOnlyCenter && isCenter);
    screenReaderText.textContent = `${options.labelPrefix} ${index + 1}マス目`;
    textarea.value = value;
    textarea.placeholder = isCenter ? "" : " ";
    textarea.readOnly = Boolean(options.readOnlyCenter && isCenter);
    textarea.setAttribute("aria-label", screenReaderText.textContent);

    if (!textarea.readOnly) {
      textarea.setAttribute("aria-keyshortcuts", "Shift+Enter");
      textarea.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !event.shiftKey ||
            event.ctrlKey || event.altKey || event.metaKey ||
            event.isComposing || event.keyCode === 229) return;

        event.preventDefault();
        textarea.blur();
      });
      let completionCandidates;
      textarea.addEventListener("blur", () => {
        lastEdit = null;
        if (completionCandidates && grid.isConnected) checkCompletion(completionCandidates);
        completionCandidates = undefined;
      });
      textarea.addEventListener("compositionstart", () => { lastEdit = null; });
      textarea.addEventListener("input", (event) => {
        if (textarea.value === cells[index]) return;
        const now = Date.now();
        if (lastEdit?.textarea !== textarea ||
            (!event.isComposing && !lastEdit.composing && now - lastEdit.time > EDIT_GROUP_MS)) {
          rememberChange();
        }
        lastEdit = { textarea, time: now, composing: event.isComposing };
        completionCandidates ??= completionTargets(grid, cells, index);
        cells[index] = textarea.value;
        if (grid === coreGrid && state.expanded) syncOuterCenter(index);
        saveState();
      });
    }

    grid.append(fragment);
    return textarea;
  });
}

function expandOuter() {
  if (state.expanded) return;
  rememberChange();
  state.expanded = true;
  syncAllCenters(state);
  saveState();
  render();
}

function syncAllCenters(chart) {
  chart.lastExpandedFrom = OUTER_CORE_INDICES.map((index) => chart.core[index]);
  chart.outer.forEach((cells, index) => {
    cells[CENTER_INDEX] = chart.lastExpandedFrom[index];
  });
}

function syncOuterCenter(coreIndex) {
  const index = OUTER_CORE_INDICES.indexOf(coreIndex);
  if (index === -1) return;

  const value = state.core[coreIndex];
  const { center, label } = outerPanels[index];
  state.outer[index][CENTER_INDEX] = value;
  state.lastExpandedFrom[index] = value;
  center.value = value;
  label.textContent = value || OUTER_LABELS[index];
}

function completionTargets(grid, cells, index) {
  const board = grid === coreGrid ? -1 : outerPanels.findIndex((panel) => panel.grid === grid);
  const targets = [{ grid, cells, board }];
  const outerIndex = OUTER_CORE_INDICES.indexOf(index);
  if (grid === coreGrid && state.expanded && outerIndex !== -1) {
    targets.push({ grid: outerPanels[outerIndex].grid, cells: state.outer[outerIndex], board: outerIndex });
  }
  return targets.filter((target) => !isComplete(target.cells));
}

function isComplete(cells) {
  return cells.every((cell) => cell.trim() !== "");
}

function markCompletedBoards() {
  celebratedBoards.clear();
  if (isComplete(state.core)) celebratedBoards.add(-1);
  state.outer.forEach((cells, index) => {
    if (isComplete(cells)) celebratedBoards.add(index);
  });
}

function checkCompletion(targets) {
  for (const { grid, cells, board } of targets) {
    if (celebratedBoards.has(board) || !isComplete(cells)) continue;
    celebratedBoards.add(board);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
    const sparkles = document.createElement("span");
    sparkles.className = "completion-sparkles";
    sparkles.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 8; i++) {
      const star = document.createElement("span");
      star.textContent = "\u2726";
      sparkles.append(star);
    }
    sparkles.addEventListener("animationend", () => sparkles.remove(), { once: true });
    grid.append(sparkles);
  }
}

function rememberChange() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastEdit = null;
}

function restoreHistory(from, to) {
  if (!from.length) return;
  const active = document.activeElement;
  const label = active?.matches(".cell textarea") ? active.getAttribute("aria-label") : null;
  const selection = label ? [active.selectionStart, active.selectionEnd] : null;

  to.push(JSON.stringify(state));
  state = JSON.parse(from.pop());
  lastEdit = null;
  saveState();
  render();

  if (label) {
    const restored = [...field.querySelectorAll("textarea")].find(
      (textarea) => textarea.getAttribute("aria-label") === label,
    );
    if (restored) {
      restored.focus({ preventScroll: true });
      restored.setSelectionRange(...selection);
    } else {
      expandButton.focus({ preventScroll: true });
    }
  }
  statusText.textContent = "";
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

function downloadSaveFile() {
  const payload = {
    app: APP_FILE_ID,
    version: SAVE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    title: state.core[CENTER_INDEX] || state.core.find((value) => value.trim()) || DEFAULT_FILE_TITLE,
    theme: "crystal-cave",
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileNameBase(payload.title)}.mandala.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  statusText.textContent = "保存ファイルを書き出しました。";
}

function stateFromSaveFile(value) {
  const rawState = value?.app === APP_FILE_ID || value?.app === "mandala-note" ? value.state : value;
  if (!rawState || typeof rawState !== "object") {
    throw new Error("Invalid save file");
  }

  const next = defaultState();
  next.core = normalizeCells(rawState.core);
  next.expanded = Boolean(rawState.expanded);
  next.outer = Array.from({ length: 8 }, (_, index) => normalizeCells(rawState.outer?.[index]));
  next.lastExpandedFrom = Array.from({ length: 8 }, (_, index) => String(rawState.lastExpandedFrom?.[index] || ""));
  if (next.expanded) syncAllCenters(next);
  return next;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    return stateFromSaveFile(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function normalizeCells(value) {
  return Array.from({ length: 9 }, (_, index) => String(Array.isArray(value) ? value[index] || "" : ""));
}

function fileNameBase(value) {
  const base = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 36);
  return base || DEFAULT_FILE_TITLE;
}
