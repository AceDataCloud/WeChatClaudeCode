import type { Session } from '../session.js';
import { logger } from '../logger.js';
import { createTranslator, type AppLocale } from '../i18n/index.js';
import { handleHelp, handleClear, handleModel, handleStatus } from './handlers.js';

export interface CommandContext {
  accountId: string;
  session: Session;
  updateSession: (partial: Partial<Session>) => void;
  clearSession: () => Session;
  text: string;
  locale?: AppLocale;
}

export interface CommandResult {
  reply?: string;
  handled: boolean;
  claudePrompt?: string; // If set, this text should be sent to Claude
}

/**
 * Parse and dispatch a slash command.
 *
 * Supported commands:
 *   /help     - Show help text with all available commands
 *   /clear    - Clear the current session
 *   /model <name> - Update the session model
 *   /status   - Show current session info
 */
export function routeCommand(ctx: CommandContext): CommandResult {
  const text = ctx.text.trim();
  const t = createTranslator(ctx.locale);

  if (!text.startsWith('/')) {
    return { handled: false };
  }

  const spaceIdx = text.indexOf(' ');
  const cmd = (spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  logger.info(`Slash command: /${cmd} ${args}`.trimEnd());

  switch (cmd) {
    case 'help':
      return handleHelp(args, ctx);
    case 'clear':
      return handleClear(ctx);
    case 'model':
      return handleModel(ctx, args);
    case 'status':
      return handleStatus(ctx);
    default:
      return { handled: false, reply: t('commands.unknownCommand', { command: cmd }) };
  }
}
