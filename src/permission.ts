import { logger } from './logger.js';
import { createTranslator, type AppLocale } from './i18n/index.js';
import type { PendingPermission } from './session.js';

const PERMISSION_TIMEOUT = 60_000;

export type OnPermissionTimeout = () => void;

export function createPermissionBroker(onTimeout?: OnPermissionTimeout) {
  const pending = new Map<string, PendingPermission>();

  function createPending(accountId: string, toolName: string, toolInput: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn('Permission timeout, auto-denied', { accountId, toolName });
        pending.delete(accountId);
        resolve(false);
        onTimeout?.();
      }, PERMISSION_TIMEOUT);

      pending.set(accountId, { toolName, toolInput, resolve, timer });
    });
  }

  function resolvePermission(accountId: string, allowed: boolean): boolean {
    const perm = pending.get(accountId);
    if (!perm) return false;
    clearTimeout(perm.timer);
    pending.delete(accountId);
    perm.resolve(allowed);
    logger.info('Permission resolved', { accountId, toolName: perm.toolName, allowed });
    return true;
  }

  function getPending(accountId: string): PendingPermission | undefined {
    return pending.get(accountId);
  }

  function formatPendingMessage(perm: PendingPermission, locale?: AppLocale): string {
    const t = createTranslator(locale);
    return [
      t('daemon.permissionRequestTitle'),
      '',
      t('daemon.permissionRequestTool', { toolName: perm.toolName }),
      t('daemon.permissionRequestInput', { toolInput: perm.toolInput.slice(0, 500) }),
      '',
      t('daemon.permissionRequestHint'),
      t('daemon.permissionRequestTimeout')
    ].join('\n');
  }

  function rejectPending(accountId: string): boolean {
    const perm = pending.get(accountId);
    if (!perm) return false;
    clearTimeout(perm.timer);
    pending.delete(accountId);
    perm.resolve(false);
    logger.info('Permission auto-rejected (session cleared)', {
      accountId,
      toolName: perm.toolName
    });
    return true;
  }

  return { createPending, resolvePermission, rejectPending, getPending, formatPendingMessage };
}
