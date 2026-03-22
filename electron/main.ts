/**
 * electron/main.ts — Electron main process
 *
 * Build: tsconfig.electron.json compiles src/ + electron/ into dist-electron/
 *   so the relative imports below resolve correctly at runtime:
 *     dist-electron/electron/main.js  →  ../src/...  =  dist-electron/src/...
 */

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  dialog,
  Notification,
  shell,
} from "electron";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

import { loadLatestAccount, type AccountData } from "../src/wechat/accounts.js";
import { startQrLogin, waitForQrScan } from "../src/wechat/login.js";
import {
  loadConfig,
  saveConfig,
  ensurePermissionModeConfig,
  type PermissionMode,
} from "../src/config.js";
import { createDaemon, type DaemonHandle } from "../src/daemon.js";
import { logger } from "../src/logger.js";
import { createSessionStore } from "../src/session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRELOAD_PATH = join(__dirname, "..", "..", "electron", "preload.cjs");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let qrWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemon: DaemonHandle | null = null;
let connectedAccount: AccountData | null = null;
let isQuitting = false;
let qrLoopRunning = false;

const sessionStore = createSessionStore();
const DATA_DIR = join(homedir(), ".wechat-claude-code");
const LOG_DIR = join(DATA_DIR, "logs");
const APP_ICON_DATA_URL =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0fd46d" />
          <stop offset="100%" stop-color="#7affb2" />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="108" height="108" rx="30" fill="#07130d" />
      <rect x="14" y="14" width="100" height="100" rx="26" fill="url(#g)" />
      <path d="M36 40h56c7.7 0 14 6.3 14 14v20c0 7.7-6.3 14-14 14H70l-15 12c-1.5 1.2-3.7.1-3.7-1.8V88H36c-7.7 0-14-6.3-14-14V54c0-7.7 6.3-14 14-14Z" fill="#062514" opacity="0.95"/>
      <circle cx="50" cy="64" r="6" fill="#86ffc0"/>
      <circle cx="64" cy="64" r="6" fill="#86ffc0"/>
      <circle cx="78" cy="64" r="6" fill="#86ffc0"/>
      <path d="M81 30c12.7 1.8 22.8 11.8 24.7 24.5" stroke="#dbffee" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
    </svg>
  `);

const SUGGESTED_MODELS = [
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-1",
  "claude-haiku-3-5",
];

const runtimeState = {
  daemonRunning: false,
  setupRequired: false,
  startedAt: "",
  lastIncomingAt: "",
  lastIncomingFrom: "",
  lastIncomingText: "",
  lastReplyAt: "",
  lastReplyText: "",
  lastErrorAt: "",
  lastError: "",
  sessionExpired: false,
  claudeWorkingDirectory: "",
  dangerousPermissionsEnabled: true,
  cwdBindingStatus: "启动时会以 UI 选择目录覆盖 Claude Session",
  pendingPermission: null as null | {
    toolName: string;
    toolInput: string;
    requestedAt: string;
  },
  recentMessages: [] as Array<{
    id: string;
    role: "incoming" | "reply" | "system" | "error";
    text: string;
    timestamp: string;
    peer: string;
  }>,
};

function pushRecentMessage(entry: {
  role: "incoming" | "reply" | "system" | "error";
  text: string;
  peer?: string;
}): void {
  runtimeState.recentMessages.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: entry.role,
    text: entry.text,
    timestamp: new Date().toISOString(),
    peer: entry.peer ?? "",
  });

  if (runtimeState.recentMessages.length > 40) {
    runtimeState.recentMessages.length = 40;
  }
}

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  // Re-focus the QR window if it's open
  if (qrWindow) {
    if (qrWindow.isMinimized()) qrWindow.restore();
    qrWindow.focus();
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  setupIpcHandlers();
  if (app.dock) {
    app.dock.setIcon(nativeImage.createFromDataURL(APP_ICON_DATA_URL));
  }
  await createQrWindow();

  const account = loadLatestAccount();
  if (account) {
    logger.info("Restoring saved account on app startup", {
      accountId: account.accountId,
    });
    connectedAccount = account;
    await startDaemon(account);
    setupTray(account);
    sendAppState({
      mode: "connected",
      accountId: account.accountId,
      workingDirectory: loadConfig().workingDirectory || homedir(),
    });
  } else {
    logger.info("No saved account found, entering login mode");
    sendAppState({ mode: "login" });
    runQrLoop();
  }
});

app.on("window-all-closed", () => {
  // Don't quit when windows are closed — stay alive in the tray
});

app.on("before-quit", () => {
  isQuitting = true;
  daemon?.stop();
});

// ---------------------------------------------------------------------------
// QR login window
// ---------------------------------------------------------------------------

async function createQrWindow(): Promise<void> {
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.show();
    qrWindow.focus();
    return;
  }

  qrWindow = new BrowserWindow({
    width: 780,
    height: 680,
    minWidth: 720,
    minHeight: 620,
    resizable: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    title: "WeChat Claude Code",
    icon: nativeImage.createFromDataURL(APP_ICON_DATA_URL),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  logger.info("Creating BrowserWindow", {
    preloadPath: PRELOAD_PATH,
    preloadExists: existsSync(PRELOAD_PATH),
  });

  qrWindow.webContents.on("did-finish-load", async () => {
    logger.info("Renderer finished load");
    try {
      const bridgeType = await qrWindow?.webContents.executeJavaScript(
        "typeof window.electronAPI",
        true,
      );
      logger.info("Renderer bridge status", { bridgeType });
    } catch (error) {
      logger.error("Failed to inspect renderer bridge", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  qrWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      logger.error("Renderer failed to load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    },
  );

  qrWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      logger.info("Renderer console", { level, message, line, sourceId });
    },
  );

  qrWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error("Renderer process gone", details);
  });

  await qrWindow.loadFile(
    join(__dirname, "..", "..", "electron", "renderer", "index.html"),
  );

  qrWindow.on("closed", () => {
    qrWindow = null;
  });

  qrWindow.on("close", (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      qrWindow?.hide();
    }
  });
}

async function runQrLoop(): Promise<void> {
  if (qrLoopRunning) return;
  qrLoopRunning = true;

  try {
    while (qrWindow) {
      try {
        sendToQrWindow("qr-status", {
          state: "loading",
          message: "正在获取二维码...",
        });

        const { qrcodeUrl, qrcodeId } = await startQrLogin();

        // Convert to data URL so the renderer can display it without file I/O
        const QRCode = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(qrcodeUrl, {
          width: 280,
          margin: 2,
        });

        sendToQrWindow("qr-update", { dataUrl, qrcodeId });
        sendToQrWindow("qr-status", {
          state: "scan",
          message: "请用微信扫描上方二维码",
        });

        const account = await waitForQrScan(qrcodeId);

        connectedAccount = account;
        runtimeState.setupRequired = true;
        runtimeState.daemonRunning = false;
        runtimeState.startedAt = "";
        logger.info("QR scan confirmed, awaiting setup confirmation", {
          accountId: account.accountId,
          workingDirectory: loadConfig().workingDirectory || homedir(),
        });
        sendToQrWindow("qr-status", {
          state: "success",
          message: "✅ 绑定成功！",
        });
        sendAppState({
          mode: "scanned",
          accountId: account.accountId,
          workingDirectory: loadConfig().workingDirectory || homedir(),
        });

        return;
      } catch (err: any) {
        if (err.message?.includes("expired")) {
          sendToQrWindow("qr-status", {
            state: "expired",
            message: "二维码已过期，正在刷新...",
          });
          continue;
        }
        sendToQrWindow("qr-status", {
          state: "error",
          message: `错误: ${err.message ?? String(err)}`,
        });
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } finally {
    qrLoopRunning = false;
  }
}

function sendToQrWindow(channel: string, data: unknown): void {
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.webContents.send(channel, data);
  }
}

function sendAppState(data: {
  mode: "login" | "scanned" | "connected";
  accountId?: string;
  workingDirectory?: string;
}): void {
  sendToQrWindow("app-state", data);
}

function summarizeText(text: string, maxLen: number = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}...`;
}

function getLatestLogPath(): string {
  try {
    const files = readdirSync(LOG_DIR)
      .filter((name) => name.startsWith("bridge-") && name.endsWith(".log"))
      .sort();
    const latest = files.at(-1);
    return latest ? join(LOG_DIR, latest) : "";
  } catch {
    return "";
  }
}

function readRecentLogs(maxLines: number = 120): string {
  const latestLogPath = getLatestLogPath();
  if (!latestLogPath || !existsSync(latestLogPath)) {
    return "暂无日志";
  }

  try {
    const content = readFileSync(latestLogPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    return lines.slice(-maxLines).join("\n") || "暂无日志";
  } catch (error) {
    return `读取日志失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getDashboardData(): {
  connected: boolean;
  setupRequired: boolean;
  accountId: string;
  userId: string;
  baseUrl: string;
  workingDirectory: string;
  daemonRunning: boolean;
  startedAt: string;
  sessionState: string;
  model: string;
  configuredModel: string;
  permissionMode: string;
  dangerousPermissionsEnabled: boolean;
  sdkSessionId: string;
  claudeWorkingDirectory: string;
  cwdBindingStatus: string;
  resumeSessionReady: boolean;
  suggestedModels: string[];
  sessionExpired: boolean;
  lastIncomingAt: string;
  lastIncomingFrom: string;
  lastIncomingText: string;
  lastReplyAt: string;
  lastReplyText: string;
  lastErrorAt: string;
  lastError: string;
  recentMessages: Array<{
    id: string;
    role: "incoming" | "reply" | "system" | "error";
    text: string;
    timestamp: string;
    peer: string;
  }>;
  pendingPermission: null | {
    toolName: string;
    toolInput: string;
    requestedAt: string;
  };
  logFile: string;
} {
  const config = ensurePermissionModeConfig(loadConfig());
  const account = connectedAccount;
  const session = account
    ? sessionStore.load(account.accountId)
    : {
        workingDirectory: config.workingDirectory || homedir(),
        state: "idle",
        model: config.model,
        permissionMode: config.permissionMode,
        sdkSessionId: "",
      };

  return {
    connected: runtimeState.daemonRunning,
    setupRequired: runtimeState.setupRequired,
    accountId: account?.accountId ?? "",
    userId: account?.userId ?? "",
    baseUrl: account?.baseUrl ?? "",
    workingDirectory: config.workingDirectory || homedir(),
    daemonRunning: runtimeState.daemonRunning,
    startedAt: runtimeState.startedAt,
    sessionState: session.state ?? "idle",
    model: session.model || config.model || "default",
    configuredModel: config.model || "default",
    permissionMode:
      session.permissionMode || config.permissionMode || "bypassPermissions",
    dangerousPermissionsEnabled:
      (session.permissionMode ||
        config.permissionMode ||
        "bypassPermissions") === "bypassPermissions",
    sdkSessionId: session.sdkSessionId || "",
    claudeWorkingDirectory:
      runtimeState.claudeWorkingDirectory ||
      session.workingDirectory ||
      config.workingDirectory ||
      homedir(),
    cwdBindingStatus:
      (runtimeState.claudeWorkingDirectory ||
        session.workingDirectory ||
        config.workingDirectory ||
        homedir()) === (config.workingDirectory || homedir())
        ? "已锁定到 UI 选择目录，daemon 启动时会强制覆盖 session cwd"
        : "当前 Claude cwd 与 UI 目录不一致，下一次启动会重新覆盖",
    resumeSessionReady: Boolean(session.sdkSessionId),
    suggestedModels: SUGGESTED_MODELS,
    sessionExpired: runtimeState.sessionExpired,
    lastIncomingAt: runtimeState.lastIncomingAt,
    lastIncomingFrom: runtimeState.lastIncomingFrom,
    lastIncomingText: runtimeState.lastIncomingText,
    lastReplyAt: runtimeState.lastReplyAt,
    lastReplyText: runtimeState.lastReplyText,
    lastErrorAt: runtimeState.lastErrorAt,
    lastError: runtimeState.lastError,
    recentMessages: runtimeState.recentMessages,
    pendingPermission: runtimeState.pendingPermission,
    logFile: getLatestLogPath(),
  };
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function setupIpcHandlers(): void {
  ipcMain.on("preload-ready", (_event, payload) => {
    logger.info("Preload ready", payload);
  });

  // Renderer asks to open a directory picker
  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "选择工作目录",
      defaultPath: homedir(),
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Renderer confirms setup after QR scan
  ipcMain.handle("confirm-setup", async (_event, workingDirectory: string) => {
    if (!connectedAccount) return { ok: false, error: "未找到账号" };

    try {
      logger.info("Setup confirmed from renderer", {
        accountId: connectedAccount.accountId,
        workingDirectory: workingDirectory || homedir(),
      });
      pushRecentMessage({
        role: "system",
        text: `目录已确认，开始启动桥接：${workingDirectory || homedir()}`,
        peer: connectedAccount.accountId,
      });
      const config = ensurePermissionModeConfig(loadConfig());
      config.workingDirectory = workingDirectory || homedir();
      saveConfig(config);

      const session = sessionStore.load(connectedAccount.accountId);
      session.workingDirectory = config.workingDirectory;
      session.permissionMode =
        config.permissionMode || session.permissionMode || "bypassPermissions";
      sessionStore.save(connectedAccount.accountId, session);
      runtimeState.claudeWorkingDirectory = session.workingDirectory;
      runtimeState.dangerousPermissionsEnabled =
        session.permissionMode === "bypassPermissions";
      runtimeState.cwdBindingStatus =
        "已锁定到 UI 选择目录，daemon 启动时会强制覆盖 session cwd";

      await startDaemon(connectedAccount);
      setupTray(connectedAccount);

      sendAppState({
        mode: "connected",
        accountId: connectedAccount.accountId,
        workingDirectory: config.workingDirectory,
      });

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });

  // Renderer asks for current config
  ipcMain.handle("get-config", () => {
    const config = ensurePermissionModeConfig(loadConfig());
    saveConfig(config);
    return {
      workingDirectory: config.workingDirectory || homedir(),
      accountId: connectedAccount?.accountId ?? "",
      connected: runtimeState.daemonRunning,
      setupRequired: runtimeState.setupRequired,
    };
  });

  ipcMain.handle("get-dashboard-data", () => {
    return getDashboardData();
  });

  ipcMain.handle("get-recent-logs", (_event, maxLines: number = 120) => {
    return { content: readRecentLogs(maxLines), logFile: getLatestLogPath() };
  });

  ipcMain.handle(
    "set-permission-mode",
    async (_event, permissionMode: string) => {
      if (
        !["default", "acceptEdits", "plan", "bypassPermissions"].includes(
          permissionMode,
        )
      ) {
        return { ok: false, error: "不支持的权限模式" };
      }

      const config = ensurePermissionModeConfig(loadConfig());
      config.permissionMode = permissionMode as PermissionMode;
      config.permissionModeExplicit = true;
      saveConfig(config);

      const account = connectedAccount;
      if (account) {
        const session = sessionStore.load(account.accountId);
        session.permissionMode = config.permissionMode;
        session.workingDirectory =
          config.workingDirectory || session.workingDirectory || homedir();
        sessionStore.save(account.accountId, session);
      }

      runtimeState.dangerousPermissionsEnabled =
        config.permissionMode === "bypassPermissions";

      pushRecentMessage({
        role: "system",
        text: `权限模式已切换为 ${permissionMode}`,
        peer: connectedAccount?.accountId ?? "",
      });

      return { ok: true, permissionMode: config.permissionMode };
    },
  );

  ipcMain.handle("set-model", async (_event, model: string) => {
    const nextModel = model.trim();
    const normalizedModel =
      nextModel === "" || nextModel === "default" ? undefined : nextModel;

    const config = ensurePermissionModeConfig(loadConfig());
    config.model = normalizedModel;
    saveConfig(config);

    const account = connectedAccount;
    if (account) {
      const session = sessionStore.load(account.accountId);
      session.model = normalizedModel;
      session.sdkSessionId = undefined;
      session.state = "idle";
      sessionStore.save(account.accountId, session);
    }

    pushRecentMessage({
      role: "system",
      text: `Claude 模型已切换为 ${normalizedModel || "default"}，下次请求会以新模型启动新 session`,
      peer: connectedAccount?.accountId ?? "",
    });

    return {
      ok: true,
      model: normalizedModel || "default",
    };
  });

  ipcMain.handle("resolve-permission", async (_event, allowed: boolean) => {
    if (!daemon || !runtimeState.pendingPermission) {
      return { ok: false, error: "当前没有待处理的权限请求" };
    }

    const toolName = runtimeState.pendingPermission.toolName;
    const resolved = daemon.resolvePermission(allowed);
    if (!resolved) {
      return { ok: false, error: "权限请求已失效" };
    }

    runtimeState.pendingPermission = null;
    pushRecentMessage({
      role: "system",
      text: `${allowed ? "已允许" : "已拒绝"}工具权限：${toolName}`,
      peer: connectedAccount?.accountId ?? "",
    });

    return { ok: true };
  });

  ipcMain.handle(
    "set-working-directory",
    async (_event, workingDirectory: string) => {
      logger.info("Renderer requested working directory update", {
        workingDirectory: workingDirectory || homedir(),
        activeAccountId: connectedAccount?.accountId ?? "",
      });
      pushRecentMessage({
        role: "system",
        text: `工作目录已更新为 ${workingDirectory || homedir()}`,
        peer: connectedAccount?.accountId ?? "",
      });
      const config = loadConfig();
      const normalizedConfig = ensurePermissionModeConfig(config);
      normalizedConfig.workingDirectory = workingDirectory || homedir();
      saveConfig(normalizedConfig);

      const account = connectedAccount;
      if (account) {
        const session = sessionStore.load(account.accountId);
        session.workingDirectory = normalizedConfig.workingDirectory;
        sessionStore.save(account.accountId, session);
        runtimeState.claudeWorkingDirectory = session.workingDirectory;
        runtimeState.cwdBindingStatus =
          "已锁定到 UI 选择目录，daemon 启动时会强制覆盖 session cwd";
        updateTrayMenu(account);
        sendAppState({
          mode: "connected",
          accountId: account.accountId,
          workingDirectory: normalizedConfig.workingDirectory,
        });
      }

      return { ok: true, workingDirectory: normalizedConfig.workingDirectory };
    },
  );

  ipcMain.handle("open-working-directory", async () => {
    const target = loadConfig().workingDirectory || homedir();
    return { result: await shell.openPath(target), path: target };
  });

  ipcMain.handle("open-log-directory", async () => {
    return { result: await shell.openPath(LOG_DIR), path: LOG_DIR };
  });

  ipcMain.handle("show-main-window", async () => {
    await createQrWindow();
    const account = connectedAccount;
    if (runtimeState.daemonRunning && account) {
      sendAppState({
        mode: "connected",
        accountId: account.accountId,
        workingDirectory: loadConfig().workingDirectory || homedir(),
      });
    } else if (runtimeState.setupRequired && account) {
      sendAppState({
        mode: "scanned",
        accountId: account.accountId,
        workingDirectory: loadConfig().workingDirectory || homedir(),
      });
    } else {
      sendAppState({ mode: "login" });
    }
    return { ok: true };
  });

  ipcMain.handle("relogin", async () => {
    logger.info("Renderer requested re-login flow");
    pushRecentMessage({
      role: "system",
      text: "已触发重新扫码流程",
      peer: connectedAccount?.accountId ?? "",
    });
    daemon?.stop();
    daemon = null;
    runtimeState.daemonRunning = false;
    runtimeState.setupRequired = false;
    connectedAccount = null;
    await createQrWindow();
    sendAppState({ mode: "login" });
    void runQrLoop();
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

async function startDaemon(account: AccountData): Promise<void> {
  if (daemon) {
    logger.info("Restarting existing daemon instance", {
      accountId: connectedAccount?.accountId ?? account.accountId,
    });
    daemon.stop();
    daemon = null;
  }

  const config = ensurePermissionModeConfig(loadConfig());
  saveConfig(config);
  const session = sessionStore.load(account.accountId);
  session.workingDirectory =
    config.workingDirectory || session.workingDirectory || homedir();
  session.permissionMode =
    config.permissionMode || session.permissionMode || "bypassPermissions";
  sessionStore.save(account.accountId, session);
  runtimeState.claudeWorkingDirectory = session.workingDirectory;
  runtimeState.dangerousPermissionsEnabled =
    session.permissionMode === "bypassPermissions";
  runtimeState.cwdBindingStatus =
    "已锁定到 UI 选择目录，daemon 启动时会强制覆盖 session cwd";
  logger.info("Starting daemon instance", {
    accountId: account.accountId,
    workingDirectory: session.workingDirectory,
    permissionMode: session.permissionMode || "bypassPermissions",
    model: config.model || "default",
  });
  pushRecentMessage({
    role: "system",
    text: `桥接已启动，工作目录：${session.workingDirectory}`,
    peer: account.accountId,
  });

  daemon = createDaemon({
    account,
    config,
    onSessionExpired: () => {
      runtimeState.sessionExpired = true;
      runtimeState.lastErrorAt = new Date().toISOString();
      runtimeState.lastError = "WeChat 会话已过期，需要重新扫码登录";
      pushRecentMessage({
        role: "error",
        text: runtimeState.lastError,
        peer: account.accountId,
      });
      logger.warn("Session expired — prompting re-login");
      showNotification("WeChat 会话已过期", "请重新登录以继续使用");
      createQrWindow().then(() => {
        sendAppState({ mode: "login" });
        void runQrLoop();
      });
    },
    onMessage: (fromUserId, text) => {
      runtimeState.sessionExpired = false;
      runtimeState.lastIncomingAt = new Date().toISOString();
      runtimeState.lastIncomingFrom = fromUserId;
      runtimeState.lastIncomingText = summarizeText(text);
      pushRecentMessage({
        role: "incoming",
        text,
        peer: fromUserId,
      });
      logger.info("Incoming WeChat message", {
        from: fromUserId,
        preview: text.slice(0, 60),
      });
    },
    onReply: (_toUserId, text) => {
      runtimeState.lastReplyAt = new Date().toISOString();
      runtimeState.lastReplyText = summarizeText(text);
      pushRecentMessage({
        role: "reply",
        text,
        peer: account.accountId,
      });
      logger.debug("Sent reply", { preview: text.slice(0, 60) });
    },
    onPermissionRequest: (toolName, toolInput) => {
      runtimeState.pendingPermission = {
        toolName,
        toolInput,
        requestedAt: new Date().toISOString(),
      };
      pushRecentMessage({
        role: "system",
        text: `Claude 请求工具权限：${toolName}`,
        peer: account.accountId,
      });
    },
    onPermissionResolved: (allowed, toolName) => {
      runtimeState.pendingPermission = null;
      pushRecentMessage({
        role: "system",
        text: `${allowed ? "已允许" : "已拒绝"} Claude 工具权限：${toolName}`,
        peer: account.accountId,
      });
    },
  });

  runtimeState.daemonRunning = true;
  runtimeState.setupRequired = false;
  runtimeState.startedAt = new Date().toISOString();
  runtimeState.lastError = "";
  runtimeState.lastErrorAt = "";
  runtimeState.sessionExpired = false;
  runtimeState.pendingPermission = null;

  // Run in background — do NOT await (it blocks until stopped)
  daemon.run().catch((err) => {
    runtimeState.daemonRunning = false;
    runtimeState.lastErrorAt = new Date().toISOString();
    runtimeState.lastError = err?.message ?? String(err);
    pushRecentMessage({
      role: "error",
      text: runtimeState.lastError,
      peer: account.accountId,
    });
    logger.error("Daemon crashed", { error: err?.message ?? String(err) });
    showNotification("服务崩溃", "正在尝试重启...");
    setTimeout(() => startDaemon(account), 5000);
  });

  logger.info("Daemon started", { accountId: account.accountId });
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------

function setupTray(account: AccountData): void {
  if (tray) {
    updateTrayMenu(account);
    return;
  }

  // Create a simple 16×16 template image programmatically
  const icon = nativeImage.createFromDataURL(APP_ICON_DATA_URL);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  if (process.platform === "darwin") {
    // macOS: show emoji in menu bar (more visible than tiny icon)
    tray.setTitle("💬");
  }

  tray.setToolTip(`WeChat Claude Code\n账号: ${account.accountId}`);
  updateTrayMenu(account);

  tray.on("double-click", () => {
    createQrWindow().then(() => {
      sendAppState({
        mode: "connected",
        accountId: account.accountId,
        workingDirectory: loadConfig().workingDirectory || homedir(),
      });
    });
  });
}

function updateTrayMenu(account: AccountData): void {
  if (!tray) return;

  const config = loadConfig();

  const menu = Menu.buildFromTemplate([
    {
      label: `✅ 已连接 (${account.accountId.slice(0, 12)}...)`,
      enabled: false,
    },
    {
      label: `📁 ${config.workingDirectory || homedir()}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "打开主窗口",
      click: async () => {
        await createQrWindow();
        sendAppState({
          mode: "connected",
          accountId: account.accountId,
          workingDirectory: config.workingDirectory || homedir(),
        });
      },
    },
    {
      label: "隐藏到托盘",
      click: () => {
        qrWindow?.hide();
      },
    },
    { type: "separator" },
    {
      label: "更改工作目录...",
      click: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          title: "选择工作目录",
          defaultPath: config.workingDirectory || homedir(),
        });
        if (!result.canceled && result.filePaths[0]) {
          config.workingDirectory = result.filePaths[0];
          saveConfig(config);
          showNotification("工作目录已更新", result.filePaths[0]);
          updateTrayMenu(account);
        }
      },
    },
    {
      label: "打开工作目录",
      click: () => {
        shell.openPath(config.workingDirectory || homedir());
      },
    },
    { type: "separator" },
    {
      label: "重新登录（换号或失效）",
      click: async () => {
        daemon?.stop();
        daemon = null;
        connectedAccount = null;
        await createQrWindow();
        sendAppState({ mode: "login" });
        runQrLoop();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      role: "quit",
    },
  ]);

  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}
