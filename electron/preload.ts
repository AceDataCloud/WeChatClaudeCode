/**
 * electron/preload.ts — Context bridge
 *
 * Exposes a safe, typed API to the renderer process.
 * contextIsolation: true means the renderer cannot access Node or Electron APIs directly.
 */

import { contextBridge, ipcRenderer } from "electron";

ipcRenderer.send("preload-ready", {
  hasContextBridge: true,
  location: "electron/preload.ts",
});

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Main → Renderer events ──────────────────────────────────────────────

  /** Listen for QR code data URL updates. */
  onQrUpdate(cb: (data: { dataUrl: string; qrcodeId: string }) => void): void {
    ipcRenderer.on("qr-update", (_event, data) => cb(data));
  },

  /** Listen for QR / connection status changes. */
  onQrStatus(cb: (status: { state: string; message: string }) => void): void {
    ipcRenderer.on("qr-status", (_event, status) => cb(status));
  },

  onAppState(
    cb: (state: {
      mode: "login" | "scanned" | "connected";
      accountId?: string;
      workingDirectory?: string;
    }) => void,
  ): void {
    ipcRenderer.on("app-state", (_event, state) => cb(state));
  },

  // ── Renderer → Main calls ────────────────────────────────────────────────

  /** Open OS directory picker — returns the chosen path or null. */
  selectDirectory(): Promise<string | null> {
    return ipcRenderer.invoke("select-directory");
  },

  /** Confirm setup with chosen working directory. */
  confirmSetup(
    workingDirectory: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("confirm-setup", workingDirectory);
  },

  /** Get current config (working directory, account status). */
  getConfig(): Promise<{
    workingDirectory: string;
    accountId: string;
    connected: boolean;
  }> {
    return ipcRenderer.invoke("get-config");
  },

  getDashboardData(): Promise<{
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
  }> {
    return ipcRenderer.invoke("get-dashboard-data");
  },

  getRecentLogs(maxLines = 120): Promise<{ content: string; logFile: string }> {
    return ipcRenderer.invoke("get-recent-logs", maxLines);
  },

  setWorkingDirectory(
    workingDirectory: string,
  ): Promise<{ ok: boolean; workingDirectory: string }> {
    return ipcRenderer.invoke("set-working-directory", workingDirectory);
  },

  setPermissionMode(
    permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions",
  ): Promise<{ ok: boolean; permissionMode?: string; error?: string }> {
    return ipcRenderer.invoke("set-permission-mode", permissionMode);
  },

  setModel(
    model: string,
  ): Promise<{ ok: boolean; model?: string; error?: string }> {
    return ipcRenderer.invoke("set-model", model);
  },

  resolvePermission(
    allowed: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("resolve-permission", allowed);
  },

  openWorkingDirectory(): Promise<{ result: string; path: string }> {
    return ipcRenderer.invoke("open-working-directory");
  },

  openLogDirectory(): Promise<{ result: string; path: string }> {
    return ipcRenderer.invoke("open-log-directory");
  },

  relogin(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("relogin");
  },

  showMainWindow(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("show-main-window");
  },
});
