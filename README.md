# Skool Daily Digest

A Chrome and Safari Web Extension that scrapes your Skool community feed and generates an AI-powered daily briefing so you never miss what matters.

Built for the **Early AI-dopters** community on Skool.

---

## Features

- **AI Digest** — Ranks all posts by importance with summaries, key insights, and tags
- **Multi-provider** — Works with Claude (Anthropic), GPT (OpenAI), Gemini (Google), or OpenRouter
- **Watched Members** — Pin specific members so their posts always surface at the top
- **Dark / Light mode** — Toggle from the header
- **Export** — Open digest as `.md` or styled `.html` in a new tab, or copy Markdown to clipboard
- **Smart cache** — Digest is cached for the day; refresh anytime with the ↺ button

---

## Chrome Installation (Developer Mode)

This extension is not on the Chrome Web Store. Install it manually:

1. Download or clone this repo
   ```
   git clone https://github.com/digitaljavelina/skool-digest.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `skool-digest` folder
5. The extension icon will appear in your toolbar

---

## Safari Installation (Developer Mode)

The Safari version lives in the Xcode wrapper project under `Skool Daily Digest/`.

1. Open `Skool Daily Digest/Skool Daily Digest.xcodeproj` in Xcode
2. Select the macOS or iOS app target for the platform you want to test
3. Set your development team in Signing & Capabilities if Xcode asks for it
4. Build and run the app from Xcode
5. Enable the extension:
   - macOS: Safari > Settings > Extensions
   - iOS: Settings > Safari > Extensions

The Safari app wrapper uses the same Web Extension assets from this repo, including `manifest.json`, `popup.html`, `src/`, and `icons/`.

---

## Setup

1. Click the extension icon → go to the **Settings** tab
2. Choose your AI provider (Claude recommended)
3. Paste your API key:
   - **Claude** → [console.anthropic.com](https://console.anthropic.com)
   - **OpenAI** → [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - **Gemini** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   - **OpenRouter** → [openrouter.ai/keys](https://openrouter.ai/keys)
4. Optionally add **Watched Members** (exact names as shown on Skool)
5. Click **Save Settings**

---

## Usage

1. Open your Skool community feed in any tab
2. Sort the feed however you want — **New**, **Top**, or **Unread** — the extension scrapes whatever is on screen
3. Click the extension icon from any tab → hit **Generate Feed Digest**
4. The AI analyses all visible posts and returns a ranked digest in ~5–15 seconds

---

## Project Structure

```
skool-digest/
├── Skool Daily Digest/  # Xcode Safari Web Extension wrapper for macOS and iOS
├── manifest.json        # Chrome extension config (Manifest V3)
├── popup.html           # Extension popup UI
├── icons/               # Extension icons (16, 48, 128px)
└── src/
    ├── popup.js         # Popup logic, rendering, settings, export
    ├── api.js           # AI provider calls (Claude / OpenAI / Gemini / OpenRouter)
    ├── content.js       # DOM scraper injected into Skool feed pages
    └── storage.js       # Chrome local storage helpers
```

---

## AI Providers

| Provider | Model | Notes |
|----------|-------|-------|
| Claude | claude-sonnet-4-6 | Default. Uses prompt caching for faster repeat runs |
| OpenAI | gpt-5.5 | JSON mode enabled |
| Gemini | gemini-2.0-flash / 2.5-flash | Auto-fallback between models |
| OpenRouter | ~anthropic/claude-haiku-latest | Uses OpenRouter's latest Claude Haiku alias |

---

## Watched Members

Add member names in Settings to make their posts always appear near the top of the digest, regardless of engagement. Names must match exactly how they appear on Skool (as shown in the avatar tooltip).

---

## License

MIT
