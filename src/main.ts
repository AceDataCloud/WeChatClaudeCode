import { createInterface } from 'node:readline';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';

import { loadLatestAccount } from './wechat/accounts.js';
import { startQrLogin, waitForQrScan } from './wechat/login.js';
import { loadConfig, saveConfig, ensurePermissionModeConfig } from './config.js';
import { createTranslator } from './i18n/index.js';
import { logger } from './logger.js';
import { createDaemon } from './daemon.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function promptUser(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function runSetup(): Promise<void> {
  const DATA_DIR = join(process.env.HOME!, '.wechat-claude-code');
  mkdirSync(DATA_DIR, { recursive: true });
  const QR_PATH = join(DATA_DIR, 'qrcode.png');

  let t = createTranslator(loadConfig().locale);
  console.log(t('cli.setupRunning'));

  // Loop: generate QR → open image → poll for scan → handle expiry → repeat
  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();

    // Generate QR code as PNG image
    const QRCode = await import('qrcode');
    const pngData = await QRCode.toBuffer(qrcodeUrl, {
      type: 'png',
      width: 400,
      margin: 2
    });
    writeFileSync(QR_PATH, pngData);

    // Open with system default viewer (Preview.app on macOS)
    execSync(`open "${QR_PATH}"`);
    console.log(t('cli.qrOpened'));
    console.log(t('cli.imagePath', { path: QR_PATH }));
    console.log(t('cli.waitingScan'));

    try {
      await waitForQrScan(qrcodeId);
      console.log(t('cli.boundSuccess'));
      break;
    } catch (err: any) {
      if (err.message?.includes('expired')) {
        console.log(t('cli.qrExpired'));
        continue;
      }
      throw err;
    }
  }

  // Clean up QR image
  try {
    unlinkSync(QR_PATH);
  } catch {}

  const config = ensurePermissionModeConfig(loadConfig());
  t = createTranslator(config.locale);
  const workingDir = await promptUser(
    t('cli.promptWorkingDirectory'),
    config.workingDirectory || process.cwd()
  );
  config.workingDirectory = workingDir;
  saveConfig(config);

  console.log(t('cli.daemonCommand'));
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

async function runDaemon(): Promise<void> {
  const config = ensurePermissionModeConfig(loadConfig());
  const t = createTranslator(config.locale);
  saveConfig(config);
  const account = loadLatestAccount();

  if (!account) {
    console.error(t('cli.noAccount'));
    process.exit(1);
  }

  const daemon = createDaemon({
    account,
    config,
    onSessionExpired: () => {
      logger.warn('Session expired, will keep retrying...');
      console.error(t('cli.sessionExpired'));
    }
  });

  // -- Graceful shutdown --

  function shutdown(): void {
    logger.info(t('cli.shuttingDown'));
    daemon.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Daemon started', { accountId: account.accountId });
  console.log(t('cli.daemonStarted', { accountId: account.accountId }));

  await daemon.run();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const command = process.argv[2];

if (command === 'setup') {
  runSetup().catch((err) => {
    console.error(createTranslator(loadConfig().locale)('cli.setupFailed'), err);
    process.exit(1);
  });
} else {
  // 'start' or no argument
  runDaemon().catch((err) => {
    console.error(createTranslator(loadConfig().locale)('cli.startFailed'), err);
    process.exit(1);
  });
}
