import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

export interface Config {
  workingDirectory: string;
  model?: string;
  permissionMode?: PermissionMode;
  permissionModeExplicit?: boolean;
}

const CONFIG_DIR = join(homedir(), ".wechat-claude-code");
const CONFIG_PATH = join(CONFIG_DIR, "config.env");

const DEFAULT_CONFIG: Config = {
  workingDirectory: process.cwd(),
  permissionMode: "bypassPermissions",
};

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function parseConfigFile(content: string): Config {
  const config: Config = { ...DEFAULT_CONFIG };
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    switch (key) {
      case "workingDirectory":
        config.workingDirectory = value;
        break;
      case "model":
        config.model = value;
        break;
      case "permissionMode":
        if (
          value === "default" ||
          value === "acceptEdits" ||
          value === "plan" ||
          value === "bypassPermissions"
        ) {
          config.permissionMode = value;
        }
        break;
      case "permissionModeExplicit":
        if (value === "true") {
          config.permissionModeExplicit = true;
        } else if (value === "false") {
          config.permissionModeExplicit = false;
        }
        break;
    }
  }
  return config;
}

export function loadConfig(): Config {
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    return parseConfigFile(content);
  } catch {
    // File does not exist yet — return defaults
    return { ...DEFAULT_CONFIG };
  }
}

export function ensurePermissionModeConfig(config: Config): Config {
  const normalized: Config = { ...config };

  if (!normalized.permissionMode) {
    normalized.permissionMode = "bypassPermissions";
  }

  // Legacy configs predate explicit permission tracking. Treat them as the old
  // default and migrate them to bypass so startup behavior matches the desktop UI.
  if (normalized.permissionModeExplicit !== true) {
    normalized.permissionMode = "bypassPermissions";
    normalized.permissionModeExplicit = true;
  }

  return normalized;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const normalized = ensurePermissionModeConfig(config);
  const lines: string[] = [];
  lines.push(`workingDirectory=${normalized.workingDirectory}`);
  if (normalized.model) {
    lines.push(`model=${normalized.model}`);
  }
  if (normalized.permissionMode) {
    lines.push(`permissionMode=${normalized.permissionMode}`);
  }
  lines.push(
    `permissionModeExplicit=${normalized.permissionModeExplicit === true ? "true" : "false"}`,
  );
  writeFileSync(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
  chmodSync(CONFIG_PATH, 0o600);
}
