const { contextBridge, ipcRenderer } = require("electron");

ipcRenderer.send("preload-ready", {
  hasContextBridge: true,
  location: "electron/preload.cjs",
});

contextBridge.exposeInMainWorld("electronAPI", {
  onQrUpdate(cb) {
    ipcRenderer.on("qr-update", (_event, data) => cb(data));
  },
  onQrStatus(cb) {
    ipcRenderer.on("qr-status", (_event, status) => cb(status));
  },
  onAppState(cb) {
    ipcRenderer.on("app-state", (_event, state) => cb(state));
  },
  selectDirectory() {
    return ipcRenderer.invoke("select-directory");
  },
  confirmSetup(workingDirectory) {
    return ipcRenderer.invoke("confirm-setup", workingDirectory);
  },
  getConfig() {
    return ipcRenderer.invoke("get-config");
  },
  getDashboardData() {
    return ipcRenderer.invoke("get-dashboard-data");
  },
  getRecentLogs(maxLines = 120) {
    return ipcRenderer.invoke("get-recent-logs", maxLines);
  },
  setWorkingDirectory(workingDirectory) {
    return ipcRenderer.invoke("set-working-directory", workingDirectory);
  },
  setPermissionMode(permissionMode) {
    return ipcRenderer.invoke("set-permission-mode", permissionMode);
  },
  setModel(model) {
    return ipcRenderer.invoke("set-model", model);
  },
  resolvePermission(allowed) {
    return ipcRenderer.invoke("resolve-permission", allowed);
  },
  openWorkingDirectory() {
    return ipcRenderer.invoke("open-working-directory");
  },
  openLogDirectory() {
    return ipcRenderer.invoke("open-log-directory");
  },
  relogin() {
    return ipcRenderer.invoke("relogin");
  },
  showMainWindow() {
    return ipcRenderer.invoke("show-main-window");
  },
});
