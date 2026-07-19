// Mr. Panda's brain — provider-agnostic LLM layer (Phase 2), hosted-first (Phase 5B).
// Two modes:
//  - "hosted" (default): talks to Mr. Panda's own backend, which holds a shared
//    Gemini key and meters free usage. Zero setup — the whole point.
//  - "byok": the user's own Gemini key, calls Google directly (unchanged behavior).
// Either way this runs in the Electron MAIN process so no key lives in the visible
// window, and the BYOK key is only ever sent to Google.

const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://nksggc8k000ssws8oowckckg.72.62.199.199.sslip.io';
// Light abuse gate shared with the server — not a real secret, just discourages
// randoms from hitting the API directly (matches server/.env's APP_TOKEN).
const APP_TOKEN = 'bmuCjk7kgvSs5hRe87VeJsBFCtFIpK6znR64dcLFws8';

let cfgPath = null;
let cfg = {
  mode: 'hosted',                  // 'hosted' | 'byok'
  deviceId: '',
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash', // BYOK only — hosted mode uses the server's fixed model
  webSearch: true
};

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function persist() { try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_e) {} }

async function init(userDataDir) {
  cfgPath = path.join(userDataDir, 'config.json');
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); }
  catch (_e) { /* first run, no config yet */ }
  if (!cfg.deviceId) { cfg.deviceId = uuid(); persist(); }
  registerDevice().catch(() => {}); // warm the device record; fine if offline at boot
}

// Never expose the raw key back to the UI — only whether one is set.
function getConfig() {
  return {
    mode: cfg.mode,
    provider: cfg.provider,
    geminiModel: cfg.mode === 'hosted' ? 'gemini-2.5-flash (hosted)' : cfg.geminiModel,
    hasKey: !!cfg.geminiKey,
    webSearch: cfg.webSearch !== false
  };
}

function saveConfig(patch) {
  if (patch && typeof patch === 'object') {
    if (patch.mode === 'hosted' || patch.mode === 'byok') cfg.mode = patch.mode;
    if (typeof patch.geminiKey === 'string' && patch.geminiKey.trim()) cfg.geminiKey = patch.geminiKey.trim();
    if (typeof patch.geminiModel === 'string' && patch.geminiModel.trim()) cfg.geminiModel = patch.geminiModel.trim();
    if (typeof patch.provider === 'string') cfg.provider = patch.provider;
    if (typeof patch.webSearch === 'boolean') cfg.webSearch = patch.webSearch;
  }
  persist();
  return getConfig();
}

// Plan/usage status for the UI's status line. Hosted = live network check;
// BYOK = purely local (no server involved).
async function getStatus() {
  if (cfg.mode !== 'hosted') return { mode: 'byok', hasKey: !!cfg.geminiKey };
  try {
    const res = await fetchTimeout(SERVER_URL + '/v1/me?device=' + encodeURIComponent(cfg.deviceId), {}, 10000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { mode: 'hosted', error: data.code || ('HTTP_' + res.status) };
    return { mode: 'hosted', plan: data.plan, limit: data.limit, usedToday: data.usedToday, remaining: data.remaining };
  } catch (_e) { return { mode: 'hosted', error: 'OFFLINE' }; }
}

const SYSTEM = [
  "You are Mr. Panda, a sharp, upbeat corporate panda in a tuxedo and sunglasses.",
  "You help a startup founder with: researching companies and markets, finding and",
  "shortlisting investors, and organizing collected data. You are witty but",
  "professional and concise. Prefer short, well-structured answers — use tight bullet",
  "lists when it helps. You CAN search the live web with Google Search — use it for",
  "anything current, factual, or specific (companies, investors, recent news, figures).",
  "Ground concrete facts in what you find and mention where they came from. Never",
  "invent names, emails, or numbers; if search turns up nothing solid, say so plainly.",
  "When asked to WRITE an email, LinkedIn message, or DM: reply with the ready-to-send",
  "draft ONLY — for emails start with a 'Subject:' line, then a blank line, then the body.",
  "Keep it tight, warm and specific, match the requested tone and recipient, sign off",
  "appropriately, and add NO commentary around the draft unless asked.",
  "Occasionally add one tasteful bamboo or finance quip — don't overdo it (never inside a draft)."
].join(' ');

const MODE_NOTE = {
  research: ' You are in RESEARCH mode right now: focus on finding and vetting investors, companies, and markets. Lean on web search, cite sources, and never invent contacts or figures.',
  write: ' You are in WRITE mode right now: focus on drafting and polishing emails, messages, and copy. When asked to write something, output the ready-to-send draft only.'
};

// ---- shared fetch-with-timeout ----
async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms || 90000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); }
  finally { clearTimeout(to); }
}

// ---- hosted backend calls ----
async function registerDevice() {
  const res = await fetchTimeout(SERVER_URL + '/v1/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: cfg.deviceId })
  }, 10000);
  const data = await res.json().catch(() => ({}));
  if (data && data.deviceId) { cfg.deviceId = data.deviceId; persist(); }
}

function friendlyHostedError(code) {
  const map = {
    LIMIT: "You've used today's free messages. Add your own Gemini key in Settings for unlimited use.",
    GLOBAL_BUSY: 'The free service is at capacity right now — try again shortly, or use your own key in Settings.',
    DB_DOWN: 'The hosted service is warming up — try again in a moment.',
    RATE: 'Slow down a little — too many requests at once.',
    NO_SERVER_KEY: 'The hosted service is misconfigured — try Bring Your Own Key in Settings.',
    OFFLINE: "Couldn't reach the hosted service — check your internet connection."
  };
  return map[code] || null;
}

async function hostedRequest(kind, extra) {
  if (!cfg.deviceId) { cfg.deviceId = uuid(); persist(); }
  let res;
  try {
    res = await fetchTimeout(SERVER_URL + '/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': APP_TOKEN },
      body: JSON.stringify(Object.assign({ deviceId: cfg.deviceId, kind }, extra))
    }, 90000);
  } catch (_e) {
    const err = new Error(friendlyHostedError('OFFLINE')); err.code = 'OFFLINE'; throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const code = data.code || ('HTTP_' + res.status);
    const err = new Error(friendlyHostedError(code) || data.error || ('Hosted service error (' + code + ').'));
    err.code = code; throw err;
  }
  return data;
}

// ---- public API (branches hosted vs BYOK) ----
async function ask(history, attachments, mode) {
  if (cfg.mode === 'hosted') {
    const data = await hostedRequest('chat', { history, attachments, mode, webSearch: cfg.webSearch !== false });
    return data.text;
  }
  if (cfg.provider === 'gemini') return askGeminiDirect(history, attachments, mode);
  if (cfg.provider === 'anthropic') { const e = new Error('Claude support is planned for later.'); e.code = 'NO_PROVIDER'; throw e; }
  const e = new Error('No brain provider configured.'); e.code = 'NO_PROVIDER'; throw e;
}

async function humanize(text, mode, opts) {
  if (cfg.mode === 'hosted') {
    const data = await hostedRequest('humanize', { text, mode, imperfect: !!(opts && opts.imperfect), custom: opts && opts.custom });
    return data.text;
  }
  return humanizeDirect(text, mode, opts);
}

async function extractInvestors(text) {
  if (cfg.mode === 'hosted') {
    const data = await hostedRequest('extract', { text });
    return data.items || [];
  }
  return extractInvestorsDirect(text);
}

// listModels only makes sense for BYOK — hosted mode has one fixed model.
async function listModels() {
  if (cfg.mode === 'hosted') return [];
  if (cfg.provider !== 'gemini') return [];
  if (!cfg.geminiKey) { const e = new Error('No API key set.'); e.code = 'NO_KEY'; throw e; }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(cfg.geminiKey);
  const res = await fetch(url);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (_e) {}
    const e = new Error('Gemini API ' + res.status + (detail ? ': ' + detail : '')); e.code = 'API_ERROR'; throw e;
  }
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

// ---- direct-to-Gemini path (BYOK — unchanged from Phase 2/3) ----
async function postGemini(url, body, ms) {
  try {
    const res = await fetchTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ms);
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (_e) {}
      const e = new Error('Gemini API ' + res.status + (detail ? ': ' + detail : '')); e.code = 'API_ERROR'; throw e;
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('Request timed out — please try again.'); e.code = 'TIMEOUT'; throw e; }
    throw err;
  }
}

async function attachmentsToParts(attachments) {
  const parts = [];
  for (const a of (attachments || [])) {
    const mime = a.mime || '';
    try {
      if (mime.startsWith('image/') || mime === 'application/pdf') {
        parts.push({ inline_data: { mime_type: mime, data: a.dataBase64 } });
      } else if (mime.indexOf('wordprocessingml.document') !== -1 || /\.docx$/i.test(a.name || '')) {
        const mammoth = require('mammoth');
        const buf = Buffer.from(a.dataBase64, 'base64');
        const out = await mammoth.extractRawText({ buffer: buf });
        parts.push({ text: 'Contents of ' + (a.name || 'document.docx') + ':\n' + (out.value || '(empty)') });
      } else {
        const txt = Buffer.from(a.dataBase64, 'base64').toString('utf8');
        parts.push({ text: 'Contents of ' + (a.name || 'file') + ':\n' + txt.slice(0, 100000) });
      }
    } catch (e) {
      parts.push({ text: '(Could not read ' + (a.name || 'a file') + ': ' + (e.message || e) + ')' });
    }
  }
  return parts;
}

async function askGeminiDirect(history, attachments, mode) {
  if (!cfg.geminiKey) { const e = new Error('No API key set.'); e.code = 'NO_KEY'; throw e; }
  const model = cfg.geminiModel || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey);

  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  const fileParts = await attachmentsToParts(attachments);
  if (fileParts.length && contents.length) contents[contents.length - 1].parts.push(...fileParts);

  const body = {
    system_instruction: { parts: [{ text: SYSTEM + (MODE_NOTE[mode] || '') }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
  };
  if (cfg.webSearch !== false) {
    body.tools = [/1\.5/.test(model) ? { google_search_retrieval: {} } : { google_search: {} }];
  }

  const data = await postGemini(url, body, 90000);
  const cand = data && data.candidates && data.candidates[0];
  const finish = cand && cand.finishReason;
  let text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';

  if (!text.trim()) {
    const e = new Error(finish === 'MAX_TOKENS'
      ? 'The model spent its whole budget thinking and left no answer. Try a lighter “-flash” model, or ask something shorter.'
      : 'Empty reply' + (finish ? ' (' + finish + ')' : '') + '.');
    e.code = 'EMPTY'; throw e;
  }
  if (finish === 'MAX_TOKENS') text += '\n\n…(cut off — say “continue” for the rest)';

  const gm = cand && cand.groundingMetadata;
  if (gm && Array.isArray(gm.groundingChunks)) {
    const seen = new Set();
    const srcs = [];
    gm.groundingChunks.forEach(c => {
      const t = c && c.web && (c.web.title || c.web.uri);
      if (t && !seen.has(t)) { seen.add(t); srcs.push(t); }
    });
    if (srcs.length) text += '\n\n🔎 Sources: ' + srcs.slice(0, 5).join(' · ');
  }
  return text.trim();
}

async function extractInvestorsDirect(text) {
  if (!cfg.geminiKey) { const e = new Error('No API key set.'); e.code = 'NO_KEY'; throw e; }
  const model = cfg.geminiModel || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey);

  const prompt = [
    'Extract every person, investor, fund, company, or contact mentioned in the TEXT below —',
    'ESPECIALLY anyone with an email, phone, handle, or profile link.',
    'Return ONLY a JSON array. Each item is an object with these string fields',
    '(use "" when unknown — copy details exactly from the TEXT, do NOT invent anything):',
    'name, firm, stage, focus, checkSize, location, contact, source, notes.',
    'Put emails / phones / handles in "contact". If the TEXT names no one, return [].'
  ].join(' ');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt + '\n\nTEXT:\n' + text }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  };

  const data = await postGemini(url, body, 60000);
  const cand = data && data.candidates && data.candidates[0];
  let txt = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
  txt = txt.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  let arr; try { arr = JSON.parse(txt); } catch (_e) { arr = []; }
  return Array.isArray(arr) ? arr : [];
}

const HUMANIZE_MODES = {
  subtle: "Voice: keep it professional but trim filler and hedging, use contractions, prefer plain words, and vary sentence length so it doesn't read as machine-uniform.",
  human: "Voice: warm and conversational, like a sharp human talking to a colleague. Loosen stiff corporate phrasing, use natural rhythm, drop clichés and AI tells.",
  ceo: "Voice: a busy founder/CEO — very short, direct, confident, no fluff and no pleasantries. Cut to essentials. No gimmicks, no fake signatures.",
  founder: "Voice: punchy, confident founder energy — direct, specific, high-energy, short sentences, no corporate hedging."
};

async function humanizeDirect(text, mode, opts) {
  if (!cfg.geminiKey) { const e = new Error('No API key set.'); e.code = 'NO_KEY'; throw e; }
  const model = cfg.geminiModel || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey);

  const modeText = (mode === 'custom' && opts && opts.custom) ? ('Voice: ' + opts.custom) : (HUMANIZE_MODES[mode] || HUMANIZE_MODES.human);
  let sys = 'You rewrite text so it reads as authentically human, not AI-generated. ' +
    'Return ONLY the rewritten text — no preamble, no quotes, no notes. Keep the original meaning and any key facts. ' +
    'Remove every em-dash (use a comma, period, or rephrase). ' + modeText;
  if (opts && opts.imperfect) {
    sys += ' Add one or two small, natural human imperfections (a casual aside, a slightly informal phrasing, or a minor typo) so it does not read as machine-perfect — subtle, still readable.';
  }

  const body = {
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
  };

  const data = await postGemini(url, body, 90000);
  const cand = data && data.candidates && data.candidates[0];
  let out = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
  out = out.trim().replace(/^["']|["']$/g, '');
  if (!out) { const e = new Error('Empty rewrite.'); e.code = 'EMPTY'; throw e; }
  return out;
}

module.exports = { init, getConfig, saveConfig, getStatus, ask, listModels, extractInvestors, humanize };
