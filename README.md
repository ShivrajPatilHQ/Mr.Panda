# Mr. Panda

A small, sharp AI assistant that lives on your Mac desktop. He roams your screen,
researches investors and companies with live web search, writes ready-to-send cold
emails, and rewrites robotic text so it reads human — then pastes it straight into
whatever app you were typing in.

Built for founders doing outreach. Free to use, open source, and self-hostable.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ShivrajPatilHQ/Mr.Panda/main/install.sh | bash
```

macOS (Apple Silicon or Intel). Installs in about 15 seconds, no API key needed.

**Windows:** download `Mr.Panda-Setup.exe` from the
[latest release](https://github.com/ShivrajPatilHQ/Mr.Panda/releases/latest).

**Linux:** download the `.AppImage` from the same page, `chmod +x` it and run it.
Note that Wayland forbids applications from moving their own windows, so the panda
will sit still there — use an X11 session if you want him to roam. Typing into other
apps also needs `xdotool`, which is X11-only.

### Platform support

| | macOS | Windows | Linux |
|---|---|---|---|
| Panda roams, chat, research, writing | ✅ | ✅ | X11 only |
| Paste into any app / Humanize a selection | ✅ | ✅ | needs `xdotool`, X11 only |
| Tested by us | ✅ | beta | community |

## How it works

| Piece | What it is |
|---|---|
| `main.js` | Electron main process — moves a transparent window to make the panda roam |
| `index.html` | The panda himself, a 24×24 pixel-art canvas sprite |
| `chat.html` | The chat window, leashed to the panda |
| `brain.js` | Provider-agnostic LLM layer (hosted mode, or your own API key) |
| `server/` | Optional hosted backend — Bun + Hono + Mongo, meters the free tier |
| `site/` | The landing page |

## Running it yourself

```bash
npm install
npm start
```

Open Settings in the chat window and paste your own API key. Works best with Claude,
but any provider key works — the key is stored locally and never leaves your Mac.

To build a distributable `.app`:

```bash
npm run dist
```

### Self-hosting the backend

You do **not** need the backend to run Mr. Panda — bring your own API key and the app
talks to your provider directly. The backend exists only to offer a zero-setup free tier
on a shared key. If you want to run your own, see [`server/README.md`](server/README.md).

## Free, Pro, and your own key

Mr. Panda is free forever with 5 messages a day on the hosted key, and unlimited if you
bring your own API key. A hosted Pro tier removes the daily limit without you needing a
key of your own — that's a convenience service, not a different product. All the code is
here either way.

## Help

Stuck, or found a bug? Email **bamboo@mrpanda.app**.

## License

Copyright (C) 2026 EmergeSphere Technologies Pvt. Ltd.

Licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).
You are free to use, study, modify, and self-host this software. If you distribute it, or
run a modified version as a network service, you must make your source available under the
same license. See [LICENSE](LICENSE) for the full terms.

Built by Shivraj.
