// Mr. Panda — an AI assistant that lives on your desktop.
// Copyright (C) 2026 EmergeSphere Technologies Pvt. Ltd.
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. It is distributed WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
// Affero General Public License for more details: <https://www.gnu.org/licenses/>.

// Mr. Panda — Electron main process (Phase 1.6)
// A small desktop pet that stays where you put him. Left alone for a quiet spell
// he walks to the nearest corner, eats his bamboo, then falls asleep there (which
// also stops the animation, so he costs no battery while you work).
// Fully CLICKABLE, hand-draggable, and can tuck into the macOS menu bar.
// Nothing here touches your system — it just moves a small floating window.

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const brain = require('./brain');
const store = require('./store');

// Safety net: a stray error in a timer/callback must not pop a crash dialog and
// kill the whole app. Log it and keep the panda running.
process.on('uncaughtException', (err) => console.error('[main] uncaught:', (err && err.stack) || err));
process.on('unhandledRejection', (err) => console.error('[main] unhandledRejection:', (err && err.stack) || err));

let win, chatWin, tray;
let histories = { research: [], write: [] };   // separate conversation per tab

// --- state ---
let onScreen = true;
let chatOpen = false;
let busy = false;         // chat open -> don't wander
let isEating = false;
let settled = false;      // parked in a corner: eating, then asleep
let dragging = false;
let dragOffset = null;
let idleSince = Date.now();
let roamTimer = null, moveTimer = null, dragTimer = null;
let lastRoamAt = Date.now();   // watchdog heartbeat — see startRoamWatchdog()

// --- tunables ---
const WIN_W = 140;        // wide enough for the pixel sprite + his briefcase
const WIN_H = 104;        // tight around the sprite so he can reach the edges
const TICK = 16;          // ~60fps
// Quiet spell before he gives up on you and goes to sit in his corner.
const IDLE_TO_CORNER_MIN = 30000;
const IDLE_TO_CORNER_MAX = 60000;
const EAT_MS = 20000;         // bamboo break in the corner, then he dozes off
const ROAM_STALL_MS = 90000;  // watchdog: nothing happened this long => re-arm

// Transparent margin between the window edges and the visible panda. Roaming
// uses these so the SPRITE (not the window) reaches the screen edges and top.
const CM = { top: 4, bottom: 16, left: 33, right: 33 };

function workArea() { return screen.getPrimaryDisplay().workArea; }
function bounds() {
  const wa = workArea();
  return {
    xmin: wa.x - CM.left, xmax: wa.x + wa.width - WIN_W + CM.right,
    ymin: wa.y - CM.top,  ymax: wa.y + wa.height - WIN_H + CM.bottom
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');

  const wa = workArea();
  win.setBounds({ x: wa.x + wa.width - WIN_W - 30, y: wa.y + wa.height - WIN_H - 30, width: WIN_W, height: WIN_H });

  win.webContents.on('did-finish-load', () => { idleSince = Date.now(); scheduleNextMove(); startRoamWatchdog(); });
}

// The chat lives in its OWN resizable window, but stays leashed to the panda:
// it opens next to him and follows him when he's dragged. It can't be dragged
// away on its own, so the two never scatter.
function createChatWindow() {
  chatWin = new BrowserWindow({
    width: 380, height: 560, minWidth: 320, minHeight: 440,
    frame: false, resizable: true, show: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: true, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  chatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  chatWin.loadFile('chat.html');
  // NOTE: intentionally no 're-anchor on resize' — that would fight the user
  // while they drag a resize handle. It re-anchors only when the panda moves.
}

// Park the chat just above the panda (or below if there's no room up top).
function positionChat() {
  if (!chatWin || !chatOpen) return;
  const pb = win.getBounds(), cb = chatWin.getBounds(), wa = workArea(), gap = 8;
  let x = Math.round(pb.x + pb.width / 2 - cb.width / 2);
  let y = pb.y - cb.height - gap;
  if (y < wa.y + 4) y = pb.y + pb.height + gap;           // no room above -> go below
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - cb.width);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - cb.height);
  chatWin.setBounds({ x, y, width: cb.width, height: cb.height });
}

function toggleChat() {
  if (!chatWin) return;
  if (chatOpen) {
    chatOpen = false; busy = false; wake();
    tell('idle');                   // close the laptop, back to roaming
    chatWin.hide(); scheduleNextMove();
  } else {
    chatOpen = true; busy = true;
    clearTimeout(roamTimer); clearInterval(moveTimer);
    tell('work');                   // he opens his laptop out of the bag
    positionChat();
    chatWin.show();                 // focus so you can type right away
    chatWin.setAlwaysOnTop(true);
  }
}

// ---- helpers ----
function pos() { const b = win.getBounds(); return { x: b.x, y: b.y }; }
function tell(state) { if (win && !win.isDestroyed()) win.webContents.send('state', state); }
// setPosition throws on NaN/Infinity or a dead window — never let that crash the app.
function safeSetPos(x, y) {
  if (!win || win.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  win.setPosition(Math.round(x), Math.round(y));
}
function clamp(x, y) {
  const b = bounds();
  return { x: Math.min(Math.max(x, b.xmin), b.xmax), y: Math.min(Math.max(y, b.ymin), b.ymax) };
}

// ---- lifelike walk: eased path + little hops ----
function walkTo(tx, ty, onArrive) {
  clearInterval(moveTimer);
  const { x: sx, y: sy } = pos();
  // Bail safely if any coordinate is not a real number (prevents setPosition crash).
  if (![sx, sy, tx, ty].every(Number.isFinite)) { if (onArrive) onArrive(); return; }
  const dist = Math.hypot(tx - sx, ty - sy);
  if (dist < 4) { if (onArrive) onArrive(); return; }
  // Pace: brisk but calm. Long treks are capped so crossing the screen doesn't
  // turn into a 17-second hop-fest — that reads as "stuck jumping", not strolling.
  const dur = Math.min(Math.max(500, dist * 8), 5200);
  const hops = Math.max(1, Math.round(dist / 90));  // fewer, longer strides
  const amp = 6;                              // hop height
  const t0 = Date.now();
  tell(tx >= sx ? 'walk-right' : 'walk-left');
  moveTimer = setInterval(() => {
    try {
      let t = (Date.now() - t0) / dur;
      if (t >= 1) {
        safeSetPos(tx, ty);
        clearInterval(moveTimer);
        if (onArrive) onArrive();
        return;
      }
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
      const hop = Math.abs(Math.sin(t * Math.PI * hops)) * amp;
      safeSetPos(sx + (tx - sx) * e, sy + (ty - sy) * e - hop);
    } catch (e) {
      // A bad frame must not silently end the walk — that used to leave him
      // frozen mid-stride forever. Log it, then carry on with the roam loop.
      console.error('[main] walk step failed:', (e && e.stack) || e);
      clearInterval(moveTimer);
      if (onArrive) onArrive();
    }
  }, TICK);
}

// Last line of defence: if anything ever leaves the roam loop unscheduled — a
// swallowed error, a drag that never reported its end — get him moving again
// rather than leaving him parked mid-screen.
function startRoamWatchdog() {
  setInterval(() => {
    if (!onScreen || busy || dragging || settled) return;
    if (Date.now() - lastRoamAt < ROAM_STALL_MS) return;
    console.warn('[main] settle timer stalled — re-arming');
    dragging = false;
    clearInterval(moveTimer);
    tell('idle');
    scheduleNextMove();
  }, 10000);
}

function nearestCorner() {
  const b = bounds(), { x, y } = pos();
  const c = [
    { x: b.xmin, y: b.ymin }, { x: b.xmax, y: b.ymin },
    { x: b.xmin, y: b.ymax }, { x: b.xmax, y: b.ymax }
  ];
  c.sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y));
  return c[0];
}

// He does NOT wander. He stands wherever you left him, and if no work comes his
// way he settles: after a quiet spell he walks to the nearest corner, sits with
// his bamboo, and then dozes off there. Nothing moves again until you want him.
function scheduleNextMove() {
  clearTimeout(roamTimer);
  lastRoamAt = Date.now();
  if (!onScreen || busy || dragging) return;
  if (settled) return;                       // already parked in his corner
  const wait = IDLE_TO_CORNER_MIN + Math.random() * (IDLE_TO_CORNER_MAX - IDLE_TO_CORNER_MIN);
  roamTimer = setTimeout(() => {
    if (!onScreen || busy || dragging || settled) return;
    const c = nearestCorner();
    walkTo(c.x, c.y, () => {
      settled = true; isEating = true; tell('eat');
      clearTimeout(roamTimer);
      roamTimer = setTimeout(() => {
        if (!onScreen || busy || dragging) return;
        isEating = false;
        tell('sleep');                       // zzZ — renderer drops to a low frame rate
      }, EAT_MS);
    });
  }, wait);
}

// Anything that means "he's wanted again": wake him and restart the quiet timer.
function wake() {
  settled = false;
  isEating = false;
  idleSince = Date.now();
}

// ---- menu bar (tray) ----
// Build a real (template) panda-silhouette icon so the click has a solid hit-area.
function makeTrayIcon() {
  const s = 18;
  const buf = Buffer.alloc(s * s * 4, 0); // transparent; template = alpha defines shape
  const A = (x, y) => { if (x >= 0 && y >= 0 && x < s && y < s) buf[(y * s + x) * 4 + 3] = 255; };
  const disc = (cx, cy, r) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) A(x, y);
      }
  };
  disc(9, 10, 6.5);  // head
  disc(4, 4, 2.6);   // left ear
  disc(14, 4, 2.6);  // right ear
  const img = nativeImage.createFromBitmap(buf, { width: s, height: s });
  img.setTemplateImage(true); // adapts to light/dark menu bar
  return img;
}

function createTray() {
  try { tray = new Tray(makeTrayIcon()); }
  catch (_e) { tray = new Tray(nativeImage.createEmpty()); tray.setTitle('🐼'); }
  tray.setToolTip('Mr. Panda — click to show / hide');
  tray.on('click', toggleScreen);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: onScreen ? 'Send to menu bar' : 'Bring to screen', click: toggleScreen },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])));
}

function showOnScreen() {
  onScreen = true; busy = false; wake();
  const wa = workArea();
  win.setBounds({ x: wa.x + wa.width - WIN_W - 30, y: wa.y + 30, width: WIN_W, height: WIN_H });
  win.show();                 // show() is reliable for accessory apps; showInactive isn't
  win.setAlwaysOnTop(true);
  tell('idle'); scheduleNextMove();
}

function toggleScreen() {
  if (onScreen) {
    onScreen = false;
    if (chatOpen) { chatOpen = false; chatWin.hide(); }  // take the chat with him
    clearTimeout(roamTimer); clearInterval(moveTimer); win.hide();
  } else {
    showOnScreen();
  }
}

// ---- IPC ----
ipcMain.on('interact', () => {
  clearInterval(moveTimer);
  wake();
  tell(busy ? 'work' : 'idle'); // keep the laptop pose while chatting
  if (!busy && !dragging) scheduleNextMove();
});

// Hand-dragging: follow the cursor while the mouse is held on the panda.
ipcMain.on('drag-start', () => {
  dragging = true; wake();
  clearTimeout(roamTimer); clearInterval(moveTimer);
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  dragOffset = { x: c.x - b.x, y: c.y - b.y };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    try {
      if (!dragging) return;
      const cc = screen.getCursorScreenPoint();
      const p = clamp(cc.x - dragOffset.x, cc.y - dragOffset.y);
      safeSetPos(p.x, p.y);
      positionChat(); // keep the chat leashed to the panda while dragging
    } catch (_e) { clearInterval(dragTimer); }
  }, TICK);
});
ipcMain.on('drag-end', () => {
  dragging = false; clearInterval(dragTimer);
  wake(); tell('idle');   // he waits where you dropped him, then settles
  if (!busy) scheduleNextMove();
});

ipcMain.on('toggle-chat', toggleChat);
ipcMain.on('close-chat', () => { if (chatOpen) toggleChat(); });

ipcMain.on('hide-to-tray', () => { if (onScreen) toggleScreen(); });
ipcMain.on('show-context-menu', () => Menu.buildFromTemplate([
  { label: 'Mr. Panda 🐼', enabled: false },
  { type: 'separator' },
  { label: 'Send to menu bar', click: () => { if (onScreen) toggleScreen(); } },
  { label: 'Quit', click: () => app.quit() }
]).popup({ window: win }));
ipcMain.on('quit-app', () => app.quit());

// ---- brain (Phase 2) ----
ipcMain.handle('ask', async (_e, payload) => {
  const message = typeof payload === 'string' ? payload : (payload && payload.message) || '';
  const attachments = (payload && payload.attachments) || [];
  const mode = (payload && payload.mode) === 'research' ? 'research' : 'write';
  const history = histories[mode];
  history.push({ role: 'user', text: message || '(sent a file)' });
  try {
    const reply = await brain.ask(history.slice(-10), attachments, mode);
    history.push({ role: 'assistant', text: reply });
    return { ok: true, text: reply };
  } catch (err) {
    history.pop(); // don't keep an unanswered turn
    return { ok: false, code: err.code || 'ERROR', error: String(err.message || err) };
  }
});
ipcMain.handle('get-config', () => brain.getConfig());
ipcMain.handle('get-status', () => brain.getStatus());
ipcMain.handle('save-config', (_e, patch) => brain.saveConfig(patch));
ipcMain.handle('list-models', async () => {
  try { return { ok: true, models: await brain.listModels() }; }
  catch (err) { return { ok: false, code: err.code || 'ERROR', error: String(err.message || err) }; }
});
ipcMain.on('reset-chat', (_e, mode) => {
  if (mode === 'research' || mode === 'write') histories[mode] = [];
  else histories = { research: [], write: [] };
});
ipcMain.on('copy-text', (_e, text) => clipboard.writeText(String(text || '')));

// Paste a draft into whatever field the user has focused (Gmail, LinkedIn, any app).
// Puts the text on the clipboard, then fires the system Cmd+V via AppleScript.
// Needs the one-time macOS Accessibility permission.
function runPaste() {
  return new Promise((resolve) => {
    exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, (err, _out, stderr) => {
      if (!err) return resolve({ ok: true });
      const msg = ((stderr || err.message || '') + '').toLowerCase();
      if (/assistive|not allowed|accessibility|1719|-25211/.test(msg)) return resolve({ ok: false, code: 'NO_PERMISSION' });
      resolve({ ok: false, error: (stderr || err.message || 'paste failed').slice(0, 140) });
    });
  });
}
ipcMain.handle('paste-into-box', async (_e, text) => {
  if (typeof text === 'string' && text) clipboard.writeText(text);
  const chatWasOpen = chatOpen;
  // Hide our app so macOS returns focus to the app the user was in before the
  // panda (with its text cursor intact) — then paste there, then come back.
  try { app.hide(); } catch (_e) {}
  await new Promise(r => setTimeout(r, 400));
  const result = await runPaste();
  await new Promise(r => setTimeout(r, 150));
  try { app.show(); } catch (_e) {}
  try { if (win && !win.isDestroyed()) win.showInactive(); } catch (_e) {}
  try { if (chatWasOpen && chatWin && !chatWin.isDestroyed()) chatWin.show(); } catch (_e) {}
  return result;
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function runKey(letter) {
  return new Promise((resolve) => {
    exec(`osascript -e 'tell application "System Events" to keystroke "${letter}" using command down'`, (err, _o, stderr) => {
      if (!err) return resolve({ ok: true });
      const msg = ((stderr || err.message || '') + '').toLowerCase();
      if (/assistive|not allowed|accessibility|1719|-25211/.test(msg)) return resolve({ ok: false, code: 'NO_PERMISSION' });
      resolve({ ok: false, error: (stderr || err.message || 'failed').slice(0, 140) });
    });
  });
}
function restoreApp(showChat) {
  try { app.show(); } catch (_e) {}
  try { if (win && !win.isDestroyed()) win.showInactive(); } catch (_e) {}
  try { if (showChat && chatWin && !chatWin.isDestroyed()) chatWin.show(); } catch (_e) {}
}

// Humanize: grab the user's selection (Cmd+C), rewrite it via the brain, and
// paste the human version back over the selection (Cmd+V) — all in the app they
// were using. Same Accessibility permission as paste.
ipcMain.handle('humanize', async (_e, payload) => {
  const mode = (payload && payload.mode) || 'human';
  const opts = { imperfect: !!(payload && payload.imperfect), custom: payload && payload.custom };
  const chatWasOpen = chatOpen;

  try { app.hide(); } catch (_e) {}          // hand focus (and the live selection) back
  await sleep(380);

  const sentinel = '__panda_nosel_' + Date.now();
  clipboard.writeText(sentinel);
  const cp = await runKey('c');              // copy the selection
  if (!cp.ok) { restoreApp(chatWasOpen); return cp; }
  await sleep(280);
  const selected = clipboard.readText();
  if (!selected || selected === sentinel || !selected.trim()) { restoreApp(chatWasOpen); return { ok: false, code: 'NO_SELECTION' }; }

  let out;
  try { out = await brain.humanize(selected, mode, opts); }
  catch (err) { restoreApp(chatWasOpen); return { ok: false, code: err.code || 'ERROR', error: String(err.message || err) }; }

  clipboard.writeText(out);
  const paste = await runKey('v');           // replace the selection with the rewrite
  await sleep(150);
  restoreApp(chatWasOpen);
  return paste.ok ? { ok: true, before: selected, after: out } : paste;
});

ipcMain.on('open-accessibility', () =>
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'));

// ---- saved investors (Phase 5) ----
ipcMain.handle('save-from-reply', async (_e, text) => {
  try {
    const found = await brain.extractInvestors(text || '');
    const added = store.add(found);
    return { ok: true, found: found.length, added, total: store.list().length };
  } catch (err) { return { ok: false, code: err.code || 'ERROR', error: String(err.message || err) }; }
});
ipcMain.handle('list-investors', () => store.list());
ipcMain.handle('remove-investor', (_e, id) => store.remove(id));
ipcMain.handle('clear-investors', () => store.clear());
ipcMain.handle('export-csv', async () => {
  if (!store.list().length) return { ok: false, error: 'No saved investors yet.' };
  const { canceled, filePath } = await dialog.showSaveDialog(chatWin, {
    title: 'Export investors', defaultPath: 'investors.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(filePath, store.toCSV()); return { ok: true, path: filePath, count: store.list().length }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  brain.init(app.getPath('userData'));
  store.init(app.getPath('userData'));
  createWindow();
  createChatWindow();
  createTray();
});
app.on('window-all-closed', () => {});
