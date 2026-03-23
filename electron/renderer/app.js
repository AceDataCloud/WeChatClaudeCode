const api = window.electronAPI;
let chosenDir = null;
let dashboardTimer = null;
let currentLocale = 'zh-CN';
let localeOptions = [];
let messages = {};

const body = document.body;
const qrCard = document.getElementById('qr-card');
const setupCard = document.getElementById('setup-card');
const connectedCard = document.getElementById('connected-card');
const messageStream = document.getElementById('message-stream');
const permissionModeSelect = document.getElementById('permission-mode-select');
const modelInput = document.getElementById('model-input');
const localeSelect = document.getElementById('locale-select');

function getByPath(object, path) {
  return path.split('.').reduce((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[segment];
  }, object);
}

function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] === undefined ? match : String(vars[key]);
  });
}

function t(key, vars = {}) {
  const value = getByPath(messages, key);
  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

function renderLocaleOptions() {
  if (!localeSelect) return;

  localeSelect.innerHTML = localeOptions
    .map((option) => `<option value="${option.code}">${option.label}</option>`)
    .join('');
  localeSelect.value = currentLocale;
}

function applyStaticTranslations() {
  document.title = t('app.title');
  document.documentElement.lang = currentLocale;

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    const attr = element.dataset.i18nAttr;
    if (!key) return;

    const value = t(key);
    if (attr) {
      element.setAttribute(attr, value);
    } else {
      element.textContent = value;
    }
  });
}

function updateI18n(payload) {
  currentLocale = payload.locale;
  localeOptions = payload.locales || [];
  messages = payload.messages || {};
  renderLocaleOptions();
  applyStaticTranslations();
}

function formatTime(value) {
  if (!value) return t('common.dash');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(currentLocale);
}

function setStatus(state, message) {
  const chip = document.getElementById('status-chip');
  const text = document.getElementById('status-text');
  chip.className = `status-chip ${state}`;
  text.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roleLabel(role) {
  if (role === 'incoming') return t('renderer.feed.incoming');
  if (role === 'reply') return t('renderer.feed.reply');
  if (role === 'error') return t('renderer.feed.error');
  return t('renderer.feed.system');
}

function renderRecentMessages(messagesList) {
  if (!messageStream) return;

  if (!messagesList || messagesList.length === 0) {
    messageStream.innerHTML = `<div class="hint">${escapeHtml(t('renderer.feed.empty'))}</div>`;
    return;
  }

  messageStream.innerHTML = messagesList
    .map((item) => {
      const peer = item.peer ? `<div class="message-peer">${escapeHtml(item.peer)}</div>` : '';
      return `
        <article class="message-item ${escapeHtml(item.role)}">
          <div class="message-meta">
            <div class="message-role">${escapeHtml(roleLabel(item.role))}</div>
            <div class="message-time">${escapeHtml(formatTime(item.timestamp))}</div>
          </div>
          ${peer}
          <div class="message-text">${escapeHtml(item.text || t('common.dash'))}</div>
        </article>
      `;
    })
    .join('');
}

function setMode(mode) {
  body.dataset.mode = mode;
  qrCard.classList.toggle('hidden', mode === 'connected');
  setupCard.classList.toggle('hidden', mode !== 'scanned');
  connectedCard.classList.toggle('hidden', mode !== 'connected');

  if (mode === 'connected') {
    setStatus('connected', t('renderer.status.connected'));
  } else if (mode === 'scanned') {
    setStatus('success', t('renderer.status.scanned'));
  } else if (mode === 'login') {
    setStatus('loading', t('renderer.status.loadingQr'));
  }
}

async function showSetupPanel() {
  const cfg = await api.getConfig();
  chosenDir = cfg.workingDirectory;
  document.getElementById('dir-display').textContent = chosenDir;
  setMode('scanned');
}

async function refreshDashboard() {
  const data = await api.getDashboardData();
  const effectivePermissionMode = data.permissionMode || 'bypassPermissions';
  const dangerousSuffix = data.dangerousPermissionsEnabled
    ? t('renderer.dashboard.dangerousSuffix')
    : '';

  document.getElementById('daemon-running').textContent = data.daemonRunning
    ? t('common.running')
    : t('common.stopped');
  document.getElementById('daemon-started-at').textContent = data.startedAt
    ? t('renderer.dashboard.daemonStartedAt', {
        time: formatTime(data.startedAt)
      })
    : t('common.notStarted');
  document.getElementById('session-state').textContent = data.sessionState || t('common.idle');
  document.getElementById('session-state-compact').textContent =
    data.sessionState || t('common.idle');
  document.getElementById('permission-mode').textContent = t(
    'renderer.dashboard.permissionSummary',
    {
      mode: effectivePermissionMode,
      suffix: dangerousSuffix
    }
  );
  document.getElementById('permission-mode-compact').textContent = effectivePermissionMode;
  document.getElementById('session-model').textContent = data.model || 'default';
  document.getElementById('configured-model').textContent = data.configuredModel || 'default';
  document.getElementById('active-model').textContent = data.model || 'default';
  document.getElementById('sdk-session-id').textContent =
    data.sdkSessionId || t('renderer.dashboard.noActiveSession');
  document.getElementById('sdk-session-id-compact').textContent =
    data.sdkSessionId || t('renderer.dashboard.noActiveSession');
  document.getElementById('session-resume-status').textContent = data.resumeSessionReady
    ? t('renderer.dashboard.resumeReady')
    : t('renderer.dashboard.resumeReset');
  document.getElementById('health-state').textContent = data.sessionExpired
    ? t('renderer.dashboard.healthSessionExpired')
    : data.lastError
      ? t('renderer.dashboard.healthAttention')
      : t('renderer.dashboard.healthHealthy');
  document.getElementById('last-error-at').textContent = data.lastErrorAt
    ? formatTime(data.lastErrorAt)
    : t('renderer.dashboard.noRecentError');

  document.getElementById('connected-pill').textContent = data.connected
    ? t('common.connected')
    : t('common.disconnected');
  document.getElementById('account-id').textContent = data.accountId || t('common.dash');
  document.getElementById('user-id').textContent = data.userId || t('common.dash');
  document.getElementById('base-url').textContent = data.baseUrl || t('common.dash');
  document.getElementById('working-directory').textContent =
    data.workingDirectory || t('common.dash');
  document.getElementById('claude-working-directory').textContent =
    data.claudeWorkingDirectory || data.workingDirectory || t('common.dash');
  document.getElementById('effective-permission-mode').textContent = effectivePermissionMode;
  document.getElementById('dangerous-skip-status').textContent = data.dangerousPermissionsEnabled
    ? t('renderer.dashboard.dangerousEnabled')
    : t('renderer.dashboard.dangerousDisabled');
  document.getElementById('dangerous-skip-status-compact').textContent =
    data.dangerousPermissionsEnabled
      ? t('renderer.dashboard.dangerousCompactOn')
      : t('renderer.dashboard.dangerousCompactOff');
  document.getElementById('cwd-binding-status').textContent =
    data.cwdBindingStatus || t('common.dash');
  document.getElementById('last-incoming').textContent = data.lastIncomingText
    ? `${formatTime(data.lastIncomingAt)}\n${data.lastIncomingText}`
    : t('common.dash');
  document.getElementById('last-reply').textContent = data.lastReplyText
    ? `${formatTime(data.lastReplyAt)}\n${data.lastReplyText}`
    : t('common.dash');
  document.getElementById('last-error').textContent = data.lastError
    ? `${formatTime(data.lastErrorAt)}\n${data.lastError}`
    : t('renderer.dashboard.noRecentErrors');

  if (permissionModeSelect) {
    permissionModeSelect.value = effectivePermissionMode;
  }

  if (modelInput) {
    modelInput.value =
      data.configuredModel && data.configuredModel !== 'default' ? data.configuredModel : '';
    modelInput.placeholder = t('renderer.controls.modelPlaceholder');
  }

  const pendingPermissionEl = document.getElementById('pending-permission');
  const approveBtn = document.getElementById('approve-permission-btn');
  const denyBtn = document.getElementById('deny-permission-btn');
  if (data.pendingPermission) {
    pendingPermissionEl.textContent = `${formatTime(data.pendingPermission.requestedAt)}\n${data.pendingPermission.toolName}\n${data.pendingPermission.toolInput}`;
    approveBtn.disabled = false;
    denyBtn.disabled = false;
  } else {
    pendingPermissionEl.textContent = t('renderer.dashboard.pendingPermissionEmpty');
    approveBtn.disabled = true;
    denyBtn.disabled = true;
  }

  renderRecentMessages(data.recentMessages);

  document.getElementById('connected-account').textContent = data.accountId || t('common.dash');
  document.getElementById('connected-dir').textContent = data.workingDirectory || t('common.dash');
  document.getElementById('last-refresh').textContent = t('renderer.dashboard.lastRefresh', {
    time: new Date().toLocaleTimeString(currentLocale)
  });

  if (data.connected) {
    setMode('connected');
  } else if (data.setupRequired) {
    setMode('scanned');
  }

  return data;
}

async function refreshLogs() {
  const result = await api.getRecentLogs(120);
  document.getElementById('log-file').textContent = result.logFile || t('electron.logs.emptyFile');
  document.getElementById('log-box').textContent = result.content || t('electron.logs.empty');
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
    const container = document.getElementById('qr-image');
    let img = container.querySelector('img');
    if (!img) {
      container.innerHTML = '';
      img = document.createElement('img');
      container.appendChild(img);
    }
    img.alt = t('renderer.qr.imageAlt');
    img.src = dataUrl;
  });

  api.onQrStatus(({ state, message }) => {
    setStatus(state, message);
    if (state === 'success') {
      showSetupPanel().catch(() => {});
    }
  });

  api.onAppState(({ mode, accountId, workingDirectory }) => {
    setMode(mode);
    if (accountId) {
      document.getElementById('connected-account').textContent = accountId;
    }
    if (workingDirectory) {
      chosenDir = workingDirectory;
      document.getElementById('connected-dir').textContent = workingDirectory;
      document.getElementById('dir-display').textContent = workingDirectory;
    }
  });

  localeSelect?.addEventListener('change', async () => {
    const result = await api.setLocale(localeSelect.value);
    if (!result.ok) {
      setStatus('error', result.error || 'Locale update failed');
      return;
    }

    updateI18n(result);
    await refreshDashboard();
    await refreshLogs();
    setMode(body.dataset.mode || 'login');
  });

  document.getElementById('pick-dir-btn').addEventListener('click', async () => {
    const picked = await api.selectDirectory();
    if (picked) {
      chosenDir = picked;
      document.getElementById('dir-display').textContent = picked;
    }
  });

  document.getElementById('change-dir-btn').addEventListener('click', async () => {
    const picked = await api.selectDirectory();
    if (!picked) return;
    chosenDir = picked;
    const result = await api.setWorkingDirectory(picked);
    document.getElementById('connected-dir').textContent = result.workingDirectory;
    document.getElementById('working-directory').textContent = result.workingDirectory;
    document.getElementById('claude-working-directory').textContent = result.workingDirectory;
  });

  document.getElementById('save-permission-mode-btn').addEventListener('click', async () => {
    const result = await api.setPermissionMode(permissionModeSelect.value);
    if (!result.ok) {
      setStatus(
        'error',
        t('renderer.actions.permissionModeUpdateFailed', {
          error: result.error
        })
      );
      return;
    }
    setStatus(
      'connected',
      t('renderer.actions.permissionModeUpdated', {
        mode: result.permissionMode
      })
    );
    await refreshDashboard();
  });

  document.getElementById('save-model-btn').addEventListener('click', async () => {
    const nextModel = (modelInput?.value || '').trim();
    const result = await api.setModel(nextModel || 'default');
    if (!result.ok) {
      setStatus('error', t('renderer.actions.modelUpdateFailed', { error: result.error }));
      return;
    }
    setStatus('connected', t('renderer.actions.modelUpdated', { model: result.model }));
    await refreshDashboard();
  });

  document.getElementById('approve-permission-btn').addEventListener('click', async () => {
    const result = await api.resolvePermission(true);
    if (!result.ok) {
      setStatus('error', t('renderer.actions.approveFailed', { error: result.error }));
      return;
    }
    setStatus('connected', t('renderer.actions.approveSuccess'));
    await refreshDashboard();
  });

  document.getElementById('deny-permission-btn').addEventListener('click', async () => {
    const result = await api.resolvePermission(false);
    if (!result.ok) {
      setStatus('error', t('renderer.actions.denyFailed', { error: result.error }));
      return;
    }
    setStatus('connected', t('renderer.actions.denySuccess'));
    await refreshDashboard();
  });

  document.getElementById('start-btn').addEventListener('click', async () => {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.textContent = t('common.starting');

    const result = await api.confirmSetup(chosenDir || '');
    if (!result.ok) {
      btn.disabled = false;
      btn.textContent = t('common.startUsing');
      setStatus('error', t('renderer.actions.startFailed', { error: result.error }));
      return;
    }

    btn.disabled = false;
    btn.textContent = t('common.startUsing');
    await refreshDashboard();
    await refreshLogs();
  });

  document.getElementById('relogin-btn').addEventListener('click', async () => {
    await api.relogin();
    setMode('login');
    setStatus('loading', t('renderer.status.loadingQr'));
    await refreshDashboard();
    await refreshLogs();
  });

  document.getElementById('open-dir-btn').addEventListener('click', async () => {
    await api.openWorkingDirectory();
  });

  document.getElementById('refresh-logs-btn').addEventListener('click', async () => {
    await refreshLogs();
    await refreshDashboard();
  });

  document.getElementById('open-log-dir-btn').addEventListener('click', async () => {
    await api.openLogDirectory();
  });
}

async function bootstrap() {
  if (!api) {
    document.getElementById('status-chip').className = 'status-chip error';
    document.getElementById('status-text').textContent =
      'Renderer initialization failed: preload did not load';
    return;
  }

  updateI18n(await api.getI18nData());
  bindEvents();

  const cfg = await api.getConfig();
  chosenDir = cfg.workingDirectory;
  document.getElementById('dir-display').textContent = chosenDir || t('common.dash');

  const dashboard = await refreshDashboard();
  await refreshLogs();

  if (!body.dataset.mode) {
    if (dashboard.connected) {
      setMode('connected');
    } else if (dashboard.setupRequired) {
      setMode('scanned');
    } else {
      setMode('login');
      setStatus('loading', t('renderer.status.loadingQr'));
    }
  }

  startPolling();
}

bootstrap().catch((error) => {
  document.getElementById('status-chip').className = 'status-chip error';
  document.getElementById('status-text').textContent =
    error instanceof Error ? error.message : String(error);
});
