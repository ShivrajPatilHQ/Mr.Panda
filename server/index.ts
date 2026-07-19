// Mr. Panda — hosted backend (Phase A)
// A small Bun + Hono server that holds the hosted Gemini key, meters free usage
// (5/day per device), and proxies AI calls so users never need their own key.
// Fully self-contained; talks only to Mongo Atlas + Gemini. Isolated Coolify app.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MongoClient } from 'mongodb';

const env = process.env;
const MONGO_URI = env.MONGO_URI || '';
const MONGO_DB = env.MONGO_DB || 'mrpanda';
const GEMINI_API_KEY = env.GEMINI_API_KEY || '';
const GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-2.0-flash';
const FREE_LIMIT = parseInt(env.FREE_DAILY_LIMIT || '5', 10) || 5;
const GLOBAL_CAP = parseInt(env.GLOBAL_DAILY_CAP || '5000', 10) || 5000;
const PORT = parseInt(env.PORT || '8080', 10);
const APP_TOKEN = env.APP_TOKEN || '';
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';
const DAY_TZ = env.DAY_TZ || 'Asia/Kolkata';

// ---------- Mongo (non-fatal connect so /health works even if DB is down) ----------
let db: any = null, mongoOk = false;
const client = MONGO_URI ? new MongoClient(MONGO_URI) : null;
async function connectMongo() {
  if (!client) { console.warn('[db] MONGO_URI not set'); return; }
  try {
    await client.connect();
    db = client.db(MONGO_DB);
    await db.collection('usage').createIndex({ deviceId: 1, day: 1 });
    mongoOk = true;
    console.log('[db] connected to', MONGO_DB);
  } catch (e: any) {
    mongoOk = false;
    console.error('[db] connect failed:', e.message, '— retrying in 5s');
    setTimeout(connectMongo, 5000);
  }
}
connectMongo();
const devices = () => db.collection('devices');
const usage = () => db.collection('usage');
const counters = () => db.collection('counters');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: DAY_TZ });

async function ensureDevice(deviceId: string) {
  const now = new Date();
  await devices().updateOne(
    { _id: deviceId },
    { $setOnInsert: { plan: 'free', createdAt: now }, $set: { lastSeen: now } },
    { upsert: true }
  );
  return devices().findOne({ _id: deviceId });
}
// Atomically consume one use if under the daily limit. Returns {ok,count}.
async function tryConsume(deviceId: string, day: string, limit: number) {
  try {
    const res = await usage().findOneAndUpdate(
      { _id: `${deviceId}:${day}`, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { deviceId, day } },
      { upsert: true, returnDocument: 'after' }
    );
    return { ok: true, count: res?.count ?? 1 };
  } catch (e: any) {
    if (e.code === 11000) return { ok: false, count: limit }; // doc exists at/over limit
    throw e;
  }
}

// ---------- basic per-IP rate limit (in-memory; fine for a single container) ----------
const ipHits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now(), WIN = 60000, MAX = 40;
  const arr = (ipHits.get(ip) || []).filter(t => now - t < WIN);
  arr.push(now); ipHits.set(ip, arr);
  return arr.length > MAX;
}

// ---------- Gemini (the brain, server-side so the key never ships) ----------
const SYSTEM = "You are Mr. Panda, a sharp, upbeat corporate panda in a tuxedo and sunglasses. You help a startup founder with researching companies and markets, finding and shortlisting investors, and organizing collected data. You are witty but professional and concise. Prefer short, well-structured answers — use tight bullet lists when it helps. You CAN search the live web with Google Search — use it for anything current, factual, or specific. Ground concrete facts in what you find and mention where they came from. Never invent names, emails, or numbers; if search turns up nothing solid, say so plainly. When asked to WRITE an email, LinkedIn message, or DM: reply with the ready-to-send draft only — for emails start with a 'Subject:' line, then a blank line, then the body. Keep it tight, warm and specific, match the requested tone, sign off appropriately, and add NO commentary around the draft unless asked. Occasionally add one tasteful bamboo or finance quip — don't overdo it (never inside a draft).";
const MODE_NOTE: any = {
  research: ' You are in RESEARCH mode right now: focus on finding and vetting investors, companies, and markets. Lean on web search, cite sources, and never invent contacts or figures.',
  write: ' You are in WRITE mode right now: focus on drafting and polishing emails, messages, and copy. When asked to write something, output the ready-to-send draft only.'
};
const HUMANIZE_MODES: any = {
  subtle: "Voice: keep it professional but trim filler and hedging, use contractions, prefer plain words, and vary sentence length.",
  human: "Voice: warm and conversational, like a sharp human talking to a colleague. Loosen stiff corporate phrasing, drop clichés and AI tells.",
  ceo: "Voice: a busy founder/CEO — very short, direct, mostly lowercase, no fluff. Cut to essentials. It may end with 'sent from my iphone'.",
  founder: "Voice: punchy, confident founder energy — direct, specific, high-energy, short sentences, no corporate hedging."
};

function geminiUrl(model: string) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(GEMINI_API_KEY);
}
async function postGemini(url: string, body: any, ms = 90000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      let detail = '';
      try { const j: any = await res.json(); detail = j?.error?.message || ''; } catch {}
      const e: any = new Error('Gemini ' + res.status + (detail ? ': ' + detail : '')); e.code = 'API_ERROR'; throw e;
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') { const e: any = new Error('Upstream timed out.'); e.code = 'TIMEOUT'; throw e; }
    throw err;
  } finally { clearTimeout(to); }
}
async function attachmentsToParts(attachments: any[]) {
  const parts: any[] = [];
  for (const a of (attachments || [])) {
    const mime = a.mime || '';
    try {
      if (mime.startsWith('image/') || mime === 'application/pdf') parts.push({ inline_data: { mime_type: mime, data: a.dataBase64 } });
      else if (mime.indexOf('wordprocessingml.document') !== -1 || /\.docx$/i.test(a.name || '')) {
        const mammoth: any = await import('mammoth');
        const out = await mammoth.extractRawText({ buffer: Buffer.from(a.dataBase64, 'base64') });
        parts.push({ text: 'Contents of ' + (a.name || 'document.docx') + ':\n' + (out.value || '(empty)') });
      } else {
        parts.push({ text: 'Contents of ' + (a.name || 'file') + ':\n' + Buffer.from(a.dataBase64, 'base64').toString('utf8').slice(0, 100000) });
      }
    } catch (e: any) { parts.push({ text: '(Could not read ' + (a.name || 'a file') + ': ' + (e.message || e) + ')' }); }
  }
  return parts;
}

async function gemChat(body: any) {
  const model = GEMINI_MODEL;
  const history = Array.isArray(body.history) ? body.history : [];
  const contents = history.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const fileParts = await attachmentsToParts(body.attachments);
  if (fileParts.length && contents.length) contents[contents.length - 1].parts.push(...fileParts);
  const req: any = {
    system_instruction: { parts: [{ text: SYSTEM + (MODE_NOTE[body.mode] || '') }] },
    contents, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
  };
  if (body.webSearch !== false) req.tools = [/1\.5/.test(model) ? { google_search_retrieval: {} } : { google_search: {} }];
  const data: any = await postGemini(geminiUrl(model), req);
  const cand = data?.candidates?.[0];
  let text = cand?.content?.parts ? cand.content.parts.map((p: any) => p.text || '').join('') : '';
  if (!text.trim()) { const e: any = new Error(cand?.finishReason === 'MAX_TOKENS' ? 'The model ran out of tokens thinking. Try a -flash model.' : 'Empty reply.'); e.code = 'EMPTY'; throw e; }
  if (cand?.finishReason === 'MAX_TOKENS') text += '\n\n…(cut off — say "continue" for the rest)';
  const gm = cand?.groundingMetadata;
  if (gm && Array.isArray(gm.groundingChunks)) {
    const seen = new Set<string>(), srcs: string[] = [];
    gm.groundingChunks.forEach((ch: any) => { const t = ch?.web?.title || ch?.web?.uri; if (t && !seen.has(t)) { seen.add(t); srcs.push(t); } });
    if (srcs.length) text += '\n\n🔎 Sources: ' + srcs.slice(0, 5).join(' · ');
  }
  return text.trim();
}
async function gemHumanize(body: any) {
  const model = GEMINI_MODEL;
  const modeText = (body.mode === 'custom' && body.custom) ? ('Voice: ' + body.custom) : (HUMANIZE_MODES[body.mode] || HUMANIZE_MODES.human);
  let sys = 'You rewrite text so it reads as authentically human, not AI-generated. Return ONLY the rewritten text — no preamble, no quotes. Keep the meaning and key facts. Remove every em-dash. ' + modeText;
  if (body.imperfect) sys += ' Add one or two small, natural human imperfections so it does not read as machine-perfect — subtle, still readable.';
  const data: any = await postGemini(geminiUrl(model), {
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts: [{ text: String(body.text || '') }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
  });
  const cand = data?.candidates?.[0];
  let out = cand?.content?.parts ? cand.content.parts.map((p: any) => p.text || '').join('') : '';
  out = out.trim().replace(/^["']|["']$/g, '');
  if (!out) { const e: any = new Error('Empty rewrite.'); e.code = 'EMPTY'; throw e; }
  return out;
}
async function gemExtract(body: any) {
  const model = GEMINI_MODEL;
  const prompt = 'Extract every person, investor, fund, company, or contact mentioned in the TEXT below — ESPECIALLY anyone with an email, phone, handle, or profile link. Return ONLY a JSON array. Each item is an object with these string fields (use "" when unknown — copy details exactly, do NOT invent): name, firm, stage, focus, checkSize, location, contact, source, notes. Put emails/phones/handles in "contact". If the TEXT names no one, return [].';
  const data: any = await postGemini(geminiUrl(model), {
    contents: [{ role: 'user', parts: [{ text: prompt + '\n\nTEXT:\n' + String(body.text || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  }, 60000);
  const cand = data?.candidates?.[0];
  let txt = cand?.content?.parts ? cand.content.parts.map((p: any) => p.text || '').join('') : '';
  txt = txt.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
  let arr: any; try { arr = JSON.parse(txt); } catch { arr = []; }
  return Array.isArray(arr) ? arr : [];
}

// ---------- routes ----------
const app = new Hono();
app.use('*', cors());
const ipOf = (c: any) => (c.req.header('x-forwarded-for')?.split(',')[0]?.trim()) || c.req.header('x-real-ip') || 'unknown';

app.get('/health', (c) => c.json({ ok: true, service: 'mrpanda', db: mongoOk, time: new Date().toISOString() }));

app.post('/v1/register', async (c) => {
  if (!mongoOk) return c.json({ ok: false, code: 'DB_DOWN' }, 503);
  const body: any = await c.req.json().catch(() => ({}));
  let deviceId = String(body.deviceId || '').trim() || crypto.randomUUID();
  await ensureDevice(deviceId);
  return c.json({ ok: true, deviceId, plan: 'free', limit: FREE_LIMIT });
});

app.get('/v1/me', async (c) => {
  if (!mongoOk) return c.json({ ok: false, code: 'DB_DOWN' }, 503);
  const deviceId = String(c.req.query('device') || '').trim();
  if (!deviceId) return c.json({ ok: false, code: 'NO_DEVICE' }, 400);
  const device: any = await ensureDevice(deviceId);
  const isPro = device.plan === 'pro' && (!device.proUntil || new Date(device.proUntil) > new Date());
  const day = today();
  const u: any = await usage().findOne({ _id: `${deviceId}:${day}` });
  const usedToday = u?.count || 0;
  return c.json({ ok: true, plan: isPro ? 'pro' : 'free', limit: FREE_LIMIT, usedToday, remaining: isPro ? null : Math.max(0, FREE_LIMIT - usedToday) });
});

app.post('/v1/generate', async (c) => {
  if (APP_TOKEN && c.req.header('x-app-token') !== APP_TOKEN) return c.json({ ok: false, code: 'FORBIDDEN' }, 403);
  if (rateLimited(ipOf(c))) return c.json({ ok: false, code: 'RATE' }, 429);
  if (!mongoOk) return c.json({ ok: false, code: 'DB_DOWN', error: 'service starting, try again' }, 503);
  if (!GEMINI_API_KEY) return c.json({ ok: false, code: 'NO_SERVER_KEY' }, 500);

  const body: any = await c.req.json().catch(() => ({}));
  const deviceId = String(body.deviceId || '').trim();
  const kind = body.kind || 'chat';
  if (!deviceId) return c.json({ ok: false, code: 'NO_DEVICE' }, 400);

  const device: any = await ensureDevice(deviceId);
  const isPro = device.plan === 'pro' && (!device.proUntil || new Date(device.proUntil) > new Date());
  const countable = kind !== 'extract';
  const day = today();

  if (!isPro && countable) {
    const g: any = await counters().findOne({ _id: `global:${day}` });
    if ((g?.count || 0) >= GLOBAL_CAP) return c.json({ ok: false, code: 'GLOBAL_BUSY' }, 429);
    const consumed = await tryConsume(deviceId, day, FREE_LIMIT);
    if (!consumed.ok) return c.json({ ok: false, code: 'LIMIT', limit: FREE_LIMIT, usedToday: FREE_LIMIT }, 429);
    await counters().updateOne({ _id: `global:${day}` }, { $inc: { count: 1 } }, { upsert: true });
  }

  try {
    if (kind === 'humanize') return c.json({ ok: true, text: await gemHumanize(body) });
    if (kind === 'extract') return c.json({ ok: true, items: await gemExtract(body) });
    return c.json({ ok: true, text: await gemChat(body) });
  } catch (err: any) {
    if (!isPro && countable) { // refund the use on upstream failure
      await usage().updateOne({ _id: `${deviceId}:${day}` }, { $inc: { count: -1 } }).catch(() => {});
      await counters().updateOne({ _id: `global:${day}` }, { $inc: { count: -1 } }).catch(() => {});
    }
    return c.json({ ok: false, code: err.code || 'ERROR', error: String(err.message || err) }, 502);
  }
});

app.get('/v1/admin/stats', async (c) => {
  if (!ADMIN_TOKEN || c.req.query('token') !== ADMIN_TOKEN) return c.json({ ok: false }, 403);
  if (!mongoOk) return c.json({ ok: false, code: 'DB_DOWN' }, 503);
  const day = today();
  const [totalDevices, proDevices, g] = await Promise.all([
    devices().countDocuments({}), devices().countDocuments({ plan: 'pro' }), counters().findOne({ _id: `global:${day}` })
  ]);
  return c.json({ ok: true, day, totalDevices, proDevices, freeUsesToday: (g as any)?.count || 0, globalCap: GLOBAL_CAP, freeLimit: FREE_LIMIT });
});

console.log(`[mrpanda] listening on :${PORT} (free ${FREE_LIMIT}/day, cap ${GLOBAL_CAP}/day, tz ${DAY_TZ})`);
export default { port: PORT, fetch: app.fetch };
