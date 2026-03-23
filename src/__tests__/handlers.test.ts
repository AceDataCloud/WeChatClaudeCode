import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../session.js';
import { handleClear, handleHelp, handleModel, handleStatus } from '../commands/handlers.js';

function createContext(overrides?: Partial<Session>) {
  const session: Session = {
    workingDirectory: '/tmp/work',
    state: 'idle',
    ...overrides
  };

  return {
    accountId: 'acc-1',
    session,
    updateSession: vi.fn((partial: Partial<Session>) => {
      Object.assign(session, partial);
    }),
    clearSession: vi.fn(() => ({
      workingDirectory: '/tmp/work',
      state: 'idle' as const
    })),
    text: ''
  };
}

describe('command handlers', () => {
  it('returns help text', () => {
    const result = handleHelp('');

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('/help');
    expect(result.reply).toContain('/status');
  });

  it('updates model when /model has args', () => {
    const ctx = createContext();

    const result = handleModel(ctx, 'claude-sonnet-4-6');

    expect(ctx.updateSession).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6' });
    expect(result.reply).toContain('claude-sonnet-4-6');
    expect(result.handled).toBe(true);
  });

  it('returns usage when /model has no args', () => {
    const ctx = createContext();

    const result = handleModel(ctx, '');

    expect(ctx.updateSession).not.toHaveBeenCalled();
    expect(result.reply).toContain('/model <模型名称>');
    expect(result.handled).toBe(true);
  });

  it('clears session', () => {
    const ctx = createContext({ model: 'claude-3-5-sonnet', state: 'processing' });

    const result = handleClear(ctx);

    expect(ctx.clearSession).toHaveBeenCalled();
    expect(ctx.session.state).toBe('idle');
    expect(result.handled).toBe(true);
  });

  it('builds status message', () => {
    const ctx = createContext({ model: 'claude-sonnet-4-6', sdkSessionId: 'sdk-123' });

    const result = handleStatus(ctx);

    expect(result.reply).toContain('模型: claude-sonnet-4-6');
    expect(result.reply).toContain('会话ID: sdk-123');
    expect(result.handled).toBe(true);
  });
});
