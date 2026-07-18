// Mr. Panda's brain — provider-agnostic LLM layer (Phase 2).
// Runs in the Electron MAIN process so the API key never lives in the visible
// window. Today it talks to Google Gemini; swapping to Claude later is just
// another branch in ask(). The key is stored in a local config file on this Mac
// (in Electron's userData folder) and is only ever sent to the provider's API.

const fs = require('fs');
const path = require('path');

let cfgPath = null;
let cfg = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash', // editable in Settings if this id ever errors
  webSearch: true                  // Phase 3: use Google Search grounding
};

function init(userDataDir) {
  cfgPath = path.join(userDataDir, 'config.json');
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); }
  catch (_e) { /* first run, no config yet */ }
}

// Never expose the raw key back to the UI — only whether one is set.
function getConfig() {
  return { provider: cfg.provider, geminiModel: cfg.geminiModel, hasKey: !!cfg.geminiKey, webSearch: cfg.webSearch !== false };
}

function saveConfig(patch) {
  if (patch && typeof patch === 'object') {
    if (typeof patch.geminiKey === 'string' && patch.geminiKey.trim()) cfg.geminiKey = patch.geminiKey.trim();
    if (typeof patch.geminiModel === 'string' && patch.geminiModel.trim()) cfg.geminiModel = patch.geminiModel.trim();
    if (typeof patch.provider === 'string') cfg.provider = patch.provider;
    if (typeof patch.webSearch === 'boolean') cfg.webSearch = patch.webSearch;
  }
  try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_e) {}
  return getConfig();
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
  "Occasionally add one tasteful bamboo or finance quip — don't overdo it."
].join(' ');

async function ask(history, attachments) {
  if (cfg.provider === 'gemini') return askGemini(history, attachments);
  if (cfg.provider === 'anthropic') { const e = new Error('Claude support is planned for later.'); e.code = 'NO_PROVIDER'; throw e; }
  const e = new Error('No brain provider configured.'); e.code = 'NO_PROVIDER'; throw e;
}

// Turn uploaded files into Gemini "parts": images/PDFs go in as data, text/Word
// files get their text pulled out and added inline.
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
        // treat everything else (txt, md, csv, json, code) as plain text
        const txt = Buffer.from(a.dataBase64, 'base64').toString('utf8');
        parts.push({ text: 'Contents of ' + (a.name || 'file') + ':\n' + txt.slice(0, 100000) });
      }
    } catch (e) {
      parts.push({ text: '(Could not read ' + (a.name || 'a file') + ': ' + (e.message || e) + ')' });
    }
  }
  return parts;
}

async function askGemini(history, attachments) {
  if (!cfg.geminiKey) { const e = new Error('No API key set.'); e.code = 'NO_KEY'; throw e; }
  const model = cfg.geminiModel || 'gemini-2.0-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.geminiKey);

  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }]
  }));

  // Attach any uploaded files to the most recent user turn.
  const fileParts = await attachmentsToParts(attachments);
  if (fileParts.length && contents.length) {
    contents[contents.length - 1].parts.push(...fileParts);
  }

  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 900 }
  };
  // Turn on live web search. Gemini 1.5 uses a different tool name than 2.0+.
  if (cfg.webSearch !== false) {
    body.tools = [/1\.5/.test(model) ? { google_search_retrieval: {} } : { google_search: {} }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ''; } catch (_e) {}
    const e = new Error('Gemini API ' + res.status + (detail ? ': ' + detail : ''));
    e.code = 'API_ERROR';
    throw e;
  }

  const data = await res.json();
  const cand = data && data.candidates && data.candidates[0];
  let text = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('')
    : '';
  if (!text.trim()) { const e = new Error('Empty reply.'); e.code = 'EMPTY'; throw e; }

  // If he actually searched, append the sources he grounded on.
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

// Ask Google which models THIS key can actually use — no guessing model IDs.
async function listModels() {
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

module.exports = { init, getConfig, saveConfig, ask, listModels };
