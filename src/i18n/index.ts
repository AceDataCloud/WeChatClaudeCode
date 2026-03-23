import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppLocale = string;

interface MessageTree {
  [key: string]: MessageTree | string;
}

export interface I18nPayload {
  locale: AppLocale;
  locales: Array<{ code: AppLocale; label: string }>;
  messages: MessageTree;
}

const DEFAULT_LOCALE = 'zh-CN';

const LOCALE_LABELS: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية'
};

const localeCache = new Map<string, MessageTree>();

function getLocalesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'locales');
}

function getNestedValue(messages: MessageTree, key: string): string | undefined {
  const result = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, messages);

  return typeof result === 'string' ? result : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

function readLocaleFile(locale: string): MessageTree | null {
  const filePath = join(getLocalesDir(), `${locale}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8')) as MessageTree;
}

export function listAvailableLocales(): AppLocale[] {
  try {
    return readdirSync(getLocalesDir())
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort((left, right) => {
        if (left === DEFAULT_LOCALE) return -1;
        if (right === DEFAULT_LOCALE) return 1;
        return left.localeCompare(right);
      });
  } catch {
    return [DEFAULT_LOCALE];
  }
}

export function resolveLocale(preferred?: string): AppLocale {
  const available = listAvailableLocales();

  if (!preferred) {
    return available.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : available[0];
  }

  if (available.includes(preferred)) {
    return preferred;
  }

  const normalized = preferred.toLowerCase();
  const exact = available.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return exact;

  if (normalized.startsWith('zh')) {
    if (normalized.includes('tw') || normalized.includes('hk') || normalized.includes('hant')) {
      const traditional = available.find((locale) => locale.toLowerCase() === 'zh-tw');
      if (traditional) return traditional;
    }

    const simplified = available.find((locale) => locale.toLowerCase() === 'zh-cn');
    if (simplified) return simplified;
  }

  const language = normalized.split(/[-_]/, 1)[0];
  const languageMatch = available.find(
    (locale) => locale.toLowerCase().split('-', 1)[0] === language
  );
  if (languageMatch) return languageMatch;

  return available.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : available[0];
}

export function detectSystemLocale(): AppLocale {
  return resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

export function loadMessages(locale?: AppLocale): MessageTree {
  const resolved = resolveLocale(locale);
  const cached = localeCache.get(resolved);
  if (cached) return cached;

  const messages = readLocaleFile(resolved) ?? readLocaleFile(DEFAULT_LOCALE) ?? {};
  localeCache.set(resolved, messages);
  return messages;
}

export function translate(
  locale: AppLocale | undefined,
  key: string,
  vars?: Record<string, string | number>
): string {
  const resolved = resolveLocale(locale);
  const primary = getNestedValue(loadMessages(resolved), key);
  const fallback = primary ?? getNestedValue(loadMessages(DEFAULT_LOCALE), key);
  return interpolate(fallback ?? key, vars);
}

export function createTranslator(locale?: AppLocale) {
  const resolved = resolveLocale(locale);
  return (key: string, vars?: Record<string, string | number>): string =>
    translate(resolved, key, vars);
}

export function getLocaleLabel(locale: AppLocale): string {
  return LOCALE_LABELS[locale] ?? locale;
}

export function getI18nPayload(locale?: AppLocale): I18nPayload {
  const resolved = resolveLocale(locale);
  return {
    locale: resolved,
    locales: listAvailableLocales().map((code) => ({
      code,
      label: getLocaleLabel(code)
    })),
    messages: loadMessages(resolved)
  };
}
