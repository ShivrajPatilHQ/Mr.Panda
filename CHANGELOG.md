# Mr. Panda — Changelog

## v1 — 2026-07-18

First stable version. A pixel-art desktop panda assistant for macOS.

### Character
- 24×24 pixel-art "Mr. Panda" (The Founder palette): midnight tux, red power tie,
  gold button, sunglasses, briefcase.
- Poses: idle, walk (leg-swap + 1px bob), sit + eat bamboo (with falling crumbs),
  work (opens a laptop out of his briefcase).
- 30fps `<canvas>` render, pixelated scaling, transparent (no background scene).

### Behavior
- Roams the whole screen on his own — now reaches the top, all edges, and corners.
- Lifelike eased walk with little hops; parks in a corner and eats bamboo when idle (~16s).
- Fully clickable and hand-draggable.
- Lives in the macOS menu bar (🐼 icon) — one click to hide / show.

### Chat
- Separate, resizable chat window "leashed" to the panda: it opens beside him,
  follows him when he's dragged, and can't be dragged away on its own.
- Click the panda → he opens his laptop AND the chat opens together.
- Selectable / copyable replies, multi-line input.
- Attachments: images, text/CSV/MD/JSON, PDF, and Word (.docx) — read and understood.
- Quick model switcher (lists the models your key can use); settings for key + web search.

### Brain
- Google Gemini (provider-agnostic layer, ready to swap to Claude).
- Live web search via Google Search grounding, with a Sources line.
- API key stored only on this Mac; sent only to Google.

### Verified for v1
- All JS parses; no stale references; no runtime errors on launch.
- All four poses render without clipping in the tightened window.
- Fixed: panda now reaches top/edges; laptop closes when chat closes;
  chat no longer fights the user while resizing.
