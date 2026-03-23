import type { CommandContext, CommandResult } from './router.js';
import { createTranslator } from '../i18n/index.js';

export function handleHelp(_args: string, ctx?: CommandContext): CommandResult {
  return { reply: createTranslator(ctx?.locale)('commands.helpText'), handled: true };
}

export function handleClear(ctx: CommandContext): CommandResult {
  const t = createTranslator(ctx.locale);
  const newSession = ctx.clearSession();
  Object.assign(ctx.session, newSession);
  return { reply: t('commands.clearSuccess'), handled: true };
}

export function handleModel(ctx: CommandContext, args: string): CommandResult {
  const t = createTranslator(ctx.locale);
  if (!args) {
    return {
      reply: t('commands.modelUsage'),
      handled: true
    };
  }
  ctx.updateSession({ model: args });
  return { reply: t('commands.modelUpdated', { model: args }), handled: true };
}

export function handleStatus(ctx: CommandContext): CommandResult {
  const t = createTranslator(ctx.locale);
  const s = ctx.session;
  const lines = [
    t('commands.statusTitle'),
    '',
    t('commands.statusWorkingDirectory', { value: s.workingDirectory }),
    t('commands.statusModel', { value: s.model ?? t('common.defaultModel') }),
    t('commands.statusSessionId', { value: s.sdkSessionId ?? t('common.none') }),
    t('commands.statusState', { value: s.state })
  ];
  return { reply: lines.join('\n'), handled: true };
}
