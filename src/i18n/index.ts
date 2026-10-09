import fa from './fa';
import en from './en';
export const locales = ['fa', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fa';
export const localeDirection: Record<Locale, 'rtl' | 'ltr'> = {
  fa: 'rtl',
  en: 'ltr',
};
export const localeTag: Record<Locale, string> = {
  fa: 'fa-IR',
  en: 'en-US',
};
export type Dictionary = typeof fa;
export const dictionaries: Record<Locale, Dictionary> = {
  fa,
  en: en as Dictionary,
};
export const LOCALE_COOKIE = 'locale';
export function normalizeLocale(value: string | undefined): Locale {
  return locales.find((l) => l === value) ?? defaultLocale;
}
// Notices carry either a semantic (key, params) pair or the raw API error
// string — never a pretranslated string — so an in-place language switch
// updates text already on screen. Raw strings are translated at render time
// with a safe generic fallback for anything unrecognized.
export type MessageKey = keyof Dictionary['messages'];
export type Message =
  | { key: MessageKey; params?: Record<string, string | number> }
  | { raw: string };
export const msg = (
  key: MessageKey,
  params?: Record<string, string | number>,
): Message => ({
  key,
  ...(params ? { params } : {}),
});
export const rawMessage = (raw: string): Message => ({ raw });
/** Render a template containing `{name}` placeholders. Unknown names stay literal. */
export function fill(
  template: string,
  params?: Record<string, string | number>,
) {
  return params
    ? template.replace(/\{(\w+)\}/g, (m, name: string) =>
        name in params ? String(params[name]) : m,
      )
    : template;
}
export function translateError(raw: string | undefined, d: Dictionary): string {
  if (raw && raw in d.apiErrors) return d.apiErrors[raw];
  return d.messages.apiFallback;
}
export function formatDate(iso: string | null, locale: Locale): string {
  return iso ? new Date(iso).toLocaleString(localeTag[locale]) : '—';
}
