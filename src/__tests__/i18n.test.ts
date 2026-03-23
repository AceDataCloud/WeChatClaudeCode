import { describe, expect, it } from 'vitest';
import { getI18nPayload, resolveLocale, translate } from '../i18n/index.js';

describe('i18n helpers', () => {
  it('falls back to zh-CN for unsupported locales', () => {
    expect(resolveLocale('unsupported-locale')).toBe('zh-CN');
  });

  it('matches language variants to available locales', () => {
    expect(resolveLocale('en-US')).toBe('en');
  });

  it('interpolates translated messages', () => {
    expect(translate('en', 'commands.modelUpdated', { model: 'claude-sonnet-4-6' })).toContain(
      'claude-sonnet-4-6'
    );
  });

  it('returns payloads with locale options and messages', () => {
    const payload = getI18nPayload('en');

    expect(payload.locale).toBe('en');
    expect(payload.locales.some((item) => item.code === 'zh-CN')).toBe(true);
    expect(payload.messages).toHaveProperty('renderer');
  });
});
