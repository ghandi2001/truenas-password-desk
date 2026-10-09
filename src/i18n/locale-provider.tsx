'use client';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  dictionaries,
  localeDirection,
  normalizeLocale,
  type Dictionary,
  type Locale,
  LOCALE_COOKIE,
} from './index';
type LocaleContextValue = {
  locale: Locale;
  d: Dictionary;
  setLocale: (next: Locale) => void;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, update] = useState(normalizeLocale(initialLocale));
  const setLocale = useCallback((next: Locale) => {
    const value = normalizeLocale(next);
    update(value);
    document.cookie = `${LOCALE_COOKIE}=${value}; Path=/; SameSite=Strict; Max-Age=31536000${
      location.protocol === 'https:' ? '; Secure' : ''
    }`;
    const root = document.documentElement;
    root.lang = value;
    root.dir = localeDirection[value];
    const d = dictionaries[value];
    document.title = d.metaTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', d.metaDescription);
  }, []);
  const value = useMemo(
    () => ({ locale, d: dictionaries[locale], setLocale }),
    [locale, setLocale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale requires LocaleProvider');
  return value;
}
