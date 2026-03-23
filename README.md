# WeChat Claude Code Bridge

Chat with Claude Code directly from WeChat using the Electron desktop app.

[![WeChat Claude Code Desktop App](https://cdn.acedata.cloud/70c7f31d1b.png)](https://cdn.acedata.cloud/70c7f31d1b.png)

## Features

- QR code login in the desktop app.
- Message bridge: text and image input to Claude Code.
- Runtime permission approval (`y/yes` and `n/no`).
- Session controls (`/help`, `/clear`, `/status`, `/model`).
- System tray for status, logs, and quick actions.

## Requirements

- Node.js 18+
- macOS, Windows, or Linux
- A personal WeChat account
- Claude Code SDK support (`@anthropic-ai/claude-agent-sdk`)

## Installation

```bash
npm install
```

The `postinstall` script compiles TypeScript automatically.

## Quick Start

1. **Build and launch the desktop app:**

```bash
npm run electron:dev
```

2. **Scan QR code** to bind your WeChat account in the app's login dialog.

3. **Start sending messages** to Claude Code from WeChat!

## Available Scripts

- `npm run build`: Compile all TypeScript sources (Node.js + Electron).
- `npm run electron:dev`: Build and run the Electron app in development mode.
- `npm run electron:pack`: Build distributable packages with `electron-builder`.

## CI Release Workflow

This project now includes GitHub Actions release automation at `.github/workflows/release.yml`.

- Trigger by tag push: push a tag like `v1.0.1` to automatically build installers and publish a GitHub Release.
- Trigger manually: run the `Build and Release Desktop Apps` workflow from Actions and optionally fill `release_tag`.

Build matrix outputs:

- Windows x64 installer (`.exe` via NSIS)
- macOS Intel x64 installer (`.dmg`)
- macOS Apple Silicon arm64 installer (`.dmg`)
- Linux x64 package (`.AppImage`)

### Tag-based Release Example

```bash
git tag v1.0.1
git push origin v1.0.1
```

After the workflow completes, the GitHub Release will contain the generated installers.

## WeChat Commands

Available slash commands:

- `/help`: Show command help.
- `/clear`: Clear current Claude session.
- `/status`: Show session status.
- `/model <name>`: Switch Claude model for the current session.

## Data Directory

Runtime data is stored under `~/.wechat-claude-code/`:

- `accounts/`: Bound account metadata.
- `config.env`: Global runtime configuration.
- `sessions/`: Per-account session data.
- `get_updates_buf`: Polling sync buffer.
- `logs/`: Rotating logs.

## Project Structure

```text
wechat-claude-code/
├── electron/               # Electron main/preload/renderer
├── src/
│   ├── claude/             # Claude SDK wrappers
│   ├── commands/           # Slash command router and handlers
│   ├── wechat/             # WeChat API/auth/media/message modules
│   └── config.ts           # Configuration
├── dist/                   # Compiled Node.js output
├── dist-electron/          # Compiled Electron output
└── package.json
```

## Troubleshooting

- If login fails, check your QR code scanner and ensure the app is up to date.
- If permissions appear stuck, reply `y` or `n` in WeChat within 60 seconds.
- If the app doesn't reflect changes, restart it with `npm run electron:dev`.

## License

MIT
