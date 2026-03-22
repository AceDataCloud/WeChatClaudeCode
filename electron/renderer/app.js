const api = window.electronAPI;
let chosenDir = null;
let dashboardTimer = null;

const body = document.body;
const qrCard = document.getElementById("qr-card");
const setupCard = document.getElementById("setup-card");
const connectedCard = document.getElementById("connected-card");
const messageStream = document.getElementById("message-stream");
const permissionModeSelect = document.getElementById("permission-mode-select");
const modelInput = document.getElementById("model-input");

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setStatus(state, message) {
  const chip = document.getElementById("status-chip");
  const text = document.getElementById("status-text");
  chip.className = `status-chip ${state}`;
  text.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roleLabel(role) {
  if (role === "incoming") return "WeChat Incoming";
  if (role === "reply") return "Claude Reply";
  if (role === "error") return "Bridge Error";
  return "Bridge Event";
}

function renderRecentMessages(messages) {
  if (!messageStream) return;

  if (!messages || messages.length === 0) {
    messageStream.innerHTML =
      '<div class="hint">还没有实时消息，等微信发一条消息过来这里就会出现。</div>';
    return;
  }

  messageStream.innerHTML = messages
    .map((item) => {
      const peer = item.peer
        ? `<div class="message-peer">${escapeHtml(item.peer)}</div>`
        : "";
      return `
        <article class="message-item ${escapeHtml(item.role)}">
          <div class="message-meta">
            <div class="message-role">${escapeHtml(roleLabel(item.role))}</div>
            <div class="message-time">${escapeHtml(formatTime(item.timestamp))}</div>
          </div>
          ${peer}
          <div class="message-text">${escapeHtml(item.text || "-")}</div>
        </article>
      `;
    })
    .join("");
}

function setMode(mode) {
  console.log("[renderer] setMode", mode);
  body.dataset.mode = mode;
  qrCard.classList.toggle("hidden", mode === "connected");
  setupCard.classList.toggle("hidden", mode !== "scanned");
  connectedCard.classList.toggle("hidden", mode !== "connected");

  if (mode === "connected") {
    setStatus("connected", "桌面桥接已连接并在后台运行");
  } else if (mode === "scanned") {
    setStatus("success", "扫码成功，选择目录后点击开始使用");
  } else if (mode === "login") {
    setStatus("loading", "正在获取二维码...");
  }
}

async function showSetupPanel() {
  console.log("[renderer] showSetupPanel");
  const cfg = await api.getConfig();
  chosenDir = cfg.workingDirectory;
  document.getElementById("dir-display").textContent = chosenDir;
  setMode("scanned");
}

async function refreshDashboard() {
  const data = await api.getDashboardData();
  console.log("[renderer] refreshDashboard", {
    connected: data.connected,
    setupRequired: data.setupRequired,
    daemonRunning: data.daemonRunning,
    accountId: data.accountId,
  });

  document.getElementById("daemon-running").textContent = data.daemonRunning
    ? "Running"
    : "Stopped";
  document.getElementById("daemon-started-at").textContent = data.startedAt
    ? `Started at ${formatTime(data.startedAt)}`
    : "尚未启动";
  document.getElementById("session-state").textContent =
    data.sessionState || "idle";
  document.getElementById("session-state-compact").textContent =
    data.sessionState || "idle";
  const effectivePermissionMode = data.permissionMode || "bypassPermissions";
  document.getElementById("permission-mode").textContent =
    `Permission: ${effectivePermissionMode}${data.dangerousPermissionsEnabled ? " · dangerous skip on" : ""}`;
  document.getElementById("permission-mode-compact").textContent =
    effectivePermissionMode;
  document.getElementById("session-model").textContent =
    data.model || "default";
  document.getElementById("configured-model").textContent =
    data.configuredModel || "default";
  document.getElementById("active-model").textContent = data.model || "default";
  document.getElementById("sdk-session-id").textContent =
    data.sdkSessionId || "无活跃 SDK Session";
  document.getElementById("sdk-session-id-compact").textContent =
    data.sdkSessionId || "无活跃 SDK Session";
  document.getElementById("session-resume-status").textContent =
    data.resumeSessionReady
      ? "可继续沿用当前 Claude session"
      : "下次请求会新建 session";
  document.getElementById("health-state").textContent = data.sessionExpired
    ? "Session Expired"
    : data.lastError
      ? "Attention Needed"
      : "Healthy";
  document.getElementById("last-error-at").textContent = data.lastErrorAt
    ? formatTime(data.lastErrorAt)
    : "最近无错误";

  document.getElementById("connected-pill").textContent = data.connected
    ? "已连接"
    : "未连接";
  document.getElementById("account-id").textContent = data.accountId || "-";
  document.getElementById("user-id").textContent = data.userId || "-";
  document.getElementById("base-url").textContent = data.baseUrl || "-";
  document.getElementById("working-directory").textContent =
    data.workingDirectory || "-";
  document.getElementById("claude-working-directory").textContent =
    data.claudeWorkingDirectory || data.workingDirectory || "-";
  document.getElementById("effective-permission-mode").textContent =
    effectivePermissionMode;
  document.getElementById("dangerous-skip-status").textContent =
    data.dangerousPermissionsEnabled
      ? "Enabled via bypassPermissions + allowDangerouslySkipPermissions"
      : "Disabled";
  document.getElementById("dangerous-skip-status-compact").textContent =
    data.dangerousPermissionsEnabled
      ? "dangerous skip on"
      : "dangerous skip off";
  document.getElementById("cwd-binding-status").textContent =
    data.cwdBindingStatus || "-";
  document.getElementById("last-incoming").textContent = data.lastIncomingText
    ? `${formatTime(data.lastIncomingAt)}\n${data.lastIncomingText}`
    : "-";
  document.getElementById("last-reply").textContent = data.lastReplyText
    ? `${formatTime(data.lastReplyAt)}\n${data.lastReplyText}`
    : "-";
  document.getElementById("last-error").textContent = data.lastError
    ? `${formatTime(data.lastErrorAt)}\n${data.lastError}`
    : "最近没有错误";

  if (permissionModeSelect) {
    permissionModeSelect.value = effectivePermissionMode;
  }

  if (modelInput) {
    modelInput.value =
      data.configuredModel && data.configuredModel !== "default"
        ? data.configuredModel
        : "";
    modelInput.placeholder = data.suggestedModels?.[0] || "default";
  }

  const pendingPermissionEl = document.getElementById("pending-permission");
  const approveBtn = document.getElementById("approve-permission-btn");
  const denyBtn = document.getElementById("deny-permission-btn");
  if (data.pendingPermission) {
    pendingPermissionEl.textContent = `${formatTime(data.pendingPermission.requestedAt)}\n${data.pendingPermission.toolName}\n${data.pendingPermission.toolInput}`;
    approveBtn.disabled = false;
    denyBtn.disabled = false;
  } else {
    pendingPermissionEl.textContent = "当前没有待审批请求";
    approveBtn.disabled = true;
    denyBtn.disabled = true;
  }

  renderRecentMessages(data.recentMessages);

  document.getElementById("connected-account").textContent =
    data.accountId || "-";
  document.getElementById("connected-dir").textContent =
    data.workingDirectory || "-";
  document.getElementById("last-refresh").textContent =
    `Refreshed ${new Date().toLocaleTimeString()}`;

  if (data.connected) {
    setMode("connected");
  } else if (data.setupRequired) {
    setMode("scanned");
  }

  return data;
}

async function refreshLogs() {
  const result = await api.getRecentLogs(120);
  document.getElementById("log-file").textContent =
    result.logFile || "暂无日志文件";
  document.getElementById("log-box").textContent = result.content || "暂无日志";
}

function startPolling() {
  if (dashboardTimer) clearInterval(dashboardTimer);
  dashboardTimer = setInterval(() => {
    refreshDashboard().catch(() => {});
    refreshLogs().catch(() => {});
  }, 3000);
}

function bindEvents() {
  api.onQrUpdate(({ dataUrl }) => {
    console.log("[renderer] onQrUpdate");
    const container = document.getElementById("qr-image");
    let img = container.querySelector("img");
    if (!img) {
      container.innerHTML = "";
      img = document.createElement("img");
      img.alt = "QR Code";
      container.appendChild(img);
    }
    img.src = dataUrl;
  });

  api.onQrStatus(({ state, message }) => {
    console.log("[renderer] onQrStatus", { state, message });
    setStatus(state, message);
    if (state === "success") {
      showSetupPanel().catch(() => {});
    }
  });

  api.onAppState(({ mode, accountId, workingDirectory }) => {
    console.log("[renderer] onAppState", { mode, accountId, workingDirectory });
    setMode(mode);
    if (accountId) {
      document.getElementById("connected-account").textContent = accountId;
    }
    if (workingDirectory) {
      chosenDir = workingDirectory;
      document.getElementById("connected-dir").textContent = workingDirectory;
      document.getElementById("dir-display").textContent = workingDirectory;
    }
  });

  document
    .getElementById("pick-dir-btn")
    .addEventListener("click", async () => {
      console.log("[renderer] pick-dir click");
      const picked = await api.selectDirectory();
      if (picked) {
        chosenDir = picked;
        document.getElementById("dir-display").textContent = picked;
      }
    });

  document
    .getElementById("change-dir-btn")
    .addEventListener("click", async () => {
      console.log("[renderer] change-dir click");
      const picked = await api.selectDirectory();
      if (!picked) return;
      chosenDir = picked;
      const result = await api.setWorkingDirectory(picked);
      document.getElementById("connected-dir").textContent =
        result.workingDirectory;
      document.getElementById("working-directory").textContent =
        result.workingDirectory;
      document.getElementById("claude-working-directory").textContent =
        result.workingDirectory;
    });

  document
    .getElementById("save-permission-mode-btn")
    .addEventListener("click", async () => {
      const result = await api.setPermissionMode(permissionModeSelect.value);
      if (!result.ok) {
        setStatus("error", `权限模式更新失败: ${result.error}`);
        return;
      }
      setStatus("connected", `权限模式已更新为 ${result.permissionMode}`);
      await refreshDashboard();
    });

  document
    .getElementById("save-model-btn")
    .addEventListener("click", async () => {
      const nextModel = (modelInput?.value || "").trim();
      const result = await api.setModel(nextModel || "default");
      if (!result.ok) {
        setStatus("error", `模型更新失败: ${result.error}`);
        return;
      }
      setStatus("connected", `模型已更新为 ${result.model}`);
      await refreshDashboard();
    });

  document
    .getElementById("approve-permission-btn")
    .addEventListener("click", async () => {
      const result = await api.resolvePermission(true);
      if (!result.ok) {
        setStatus("error", `允许失败: ${result.error}`);
        return;
      }
      setStatus("connected", "已允许当前工具权限");
      await refreshDashboard();
    });

  document
    .getElementById("deny-permission-btn")
    .addEventListener("click", async () => {
      const result = await api.resolvePermission(false);
      if (!result.ok) {
        setStatus("error", `拒绝失败: ${result.error}`);
        return;
      }
      setStatus("connected", "已拒绝当前工具权限");
      await refreshDashboard();
    });

  document.getElementById("start-btn").addEventListener("click", async () => {
    console.log("[renderer] start-btn click", { chosenDir });
    const btn = document.getElementById("start-btn");
    btn.disabled = true;
    btn.textContent = "启动中...";

    const result = await api.confirmSetup(chosenDir || "");
    console.log("[renderer] confirmSetup result", result);
    if (!result.ok) {
      btn.disabled = false;
      btn.textContent = "开始使用";
      setStatus("error", `启动失败: ${result.error}`);
      return;
    }

    btn.disabled = false;
    btn.textContent = "开始使用";
    await refreshDashboard();
    await refreshLogs();
  });

  document.getElementById("relogin-btn").addEventListener("click", async () => {
    console.log("[renderer] relogin click");
    await api.relogin();
    setMode("login");
    setStatus("loading", "正在获取二维码...");
    await refreshDashboard();
    await refreshLogs();
  });

  document
    .getElementById("open-dir-btn")
    .addEventListener("click", async () => {
      await api.openWorkingDirectory();
    });

  document
    .getElementById("refresh-logs-btn")
    .addEventListener("click", async () => {
      await refreshLogs();
      await refreshDashboard();
    });

  document
    .getElementById("open-log-dir-btn")
    .addEventListener("click", async () => {
      await api.openLogDirectory();
    });
}

async function bootstrap() {
  if (!api) {
    document.getElementById("status-chip").className = "status-chip error";
    document.getElementById("status-text").textContent =
      "Renderer 初始化失败：preload 未加载";
    return;
  }

  bindEvents();

  const cfg = await api.getConfig();
  console.log("[renderer] bootstrap config", cfg);
  chosenDir = cfg.workingDirectory;
  document.getElementById("dir-display").textContent = chosenDir || "-";

  const dashboard = await refreshDashboard();
  await refreshLogs();

  if (!body.dataset.mode) {
    if (dashboard.connected) {
      setMode("connected");
    } else if (dashboard.setupRequired) {
      setMode("scanned");
    } else {
      setMode("login");
      setStatus("loading", "正在获取二维码...");
    }
  }

  startPolling();
}

bootstrap().catch((error) => {
  document.getElementById("status-chip").className = "status-chip error";
  document.getElementById("status-text").textContent =
    error instanceof Error ? error.message : String(error);
});
