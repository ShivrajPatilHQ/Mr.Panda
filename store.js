// Saved-investor store (Phase 5). A small JSON file in Electron's userData folder
// holds everything Mr. Panda collects, so it survives restarts. Dedupes by name+firm.
const fs = require('fs');
const path = require('path');

const COLS = ['name', 'firm', 'stage', 'focus', 'checkSize', 'location', 'contact', 'source', 'notes'];

let file = null;
let items = [];

function init(userDataDir) {
  file = path.join(userDataDir, 'investors.json');
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(items)) items = []; }
  catch (_e) { items = []; }
}
function persist() { try { fs.writeFileSync(file, JSON.stringify(items, null, 2)); } catch (_e) {} }

function list() { return items; }

function key(name, firm) { return ((name || '') + '|' + (firm || '')).trim().toLowerCase(); }

function add(arr) {
  let added = 0;
  (arr || []).forEach(it => {
    const name = String(it.name || '').trim();
    const firm = String(it.firm || '').trim();
    if (!name && !firm) return;                 // skip empty
    const k = key(name, firm);
    if (items.some(x => key(x.name, x.firm) === k)) return;  // dedupe
    const row = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    COLS.forEach(c => { row[c] = String(it[c] || '').trim(); });
    row.name = name; row.firm = firm;
    row.addedAt = new Date().toISOString();
    items.push(row);
    added++;
  });
  if (added) persist();
  return added;
}

function remove(id) { items = items.filter(x => x.id !== id); persist(); return items; }
function clear() { items = []; persist(); return items; }

function toCSV() {
  const cols = COLS.concat(['addedAt']);
  const esc = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [cols.join(',')];
  items.forEach(it => rows.push(cols.map(c => esc(it[c])).join(',')));
  return rows.join('\n');
}

module.exports = { init, list, add, remove, clear, toCSV, COLS };
