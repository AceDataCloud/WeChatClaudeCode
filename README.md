# WeChat Claude Code Bridge

Chat with Claude Code directly from WeChat.

Desktop App Screenshot:

[![WeChat Claude Code Desktop App](https://cdn.acedata.cloud/70c7f31d1b.png)](https://cdn.acedata.cloud/70c7f31d1b.png)

This project includes:

- A CLI setup and daemon workflow for account binding and message polling.
- An Electron desktop app for QR login, runtime status, logs, and permission approval.
- A bridge layer that forwards WeChat text/image messages to Claude Code.

## Features

- WeChat account binding via QR code.
- Message bridge: text and image input to Claude Code.
- Runtime permission approval flow (`y/yes` and `n/no`).
- Session controls (`/help`, `/clear`, `/status`, `/model`, `/skills`).
- Launchd-based daemon management on macOS.
- Electron tray app for status, logs, and quick actions.

## Requirements

- Node.js 18+
- macOS (daemon script uses launchd)
- A personal WeChat account
- Claude Code SDK support (`@anthropic-ai/claude-agent-sdk`)

## Installation

```bash
npm install
```

The `postinstall` script compiles TypeScript automatically.

## Quick Start

### 1. Build

```bash
npm run build
npm run electron:build
```

### 2. Bind WeChat Account

```bash
npm run setup
```

This opens a QR code image. Scan it with WeChat to bind your account.

### 3. Start Background Bridge

```bash
npm run daemon -- start
```

Check status and logs:

```bash
npm run daemon -- status
npm run daemon -- logs
```

### 4. Launch Desktop App (Optional)

```bash
npm run electron:dev
```

## Available Scripts

- `npm run build`: Compile main TypeScript sources.
- `npm run start`: Run the compiled CLI entry.
- `npm run setup`: Run interactive setup and account binding.
- `npm run daemon -- <start|stop|restart|status|logs>`: Manage launchd daemon.
- `npm run electron:build`: Compile Electron process sources.
- `npm run electron:dev`: Build and run Electron app.
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

Send these commands in WeChat chat:

- `/help`: Show command help.
- `/clear`: Clear current Claude session.
- `/status`: Show session status.
- `/model <name>`: Switch Claude model for the current session.
- `/skills`: List installed skills.
- `/<skill> [args]`: Trigger an installed skill.

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
├── scripts/                # Daemon management scripts
├── src/
│   ├── claude/             # Claude SDK wrappers and skill scanning
│   ├── commands/           # Slash command router and handlers
│   ├── wechat/             # WeChat API/auth/media/message modules
│   ├── daemon.ts           # Background bridge runtime
│   └── main.ts             # CLI entry (setup/start)
├── dist/                   # Compiled Node.js output
├── dist-electron/          # Compiled Electron output
└── package.json
```

## Troubleshooting

- If setup fails, rerun `npm run setup` to refresh QR binding.
- If daemon is offline, run `npm run daemon -- restart`.
- If permissions appear stuck, reply `y` or `n` in WeChat within 60 seconds.
- If Electron does not show updated state, restart with `npm run electron:dev`.

## License

MIT
