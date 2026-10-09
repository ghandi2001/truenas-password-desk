'use client';
import { useLocale } from '@/i18n/locale-provider';
export function Chrome({ children }: { children: React.ReactNode }) {
  const { locale, d, setLocale } = useLocale();
  return (
    <>
      <a className="skip" href="#main">
        {d.skip}
      </a>
      <header className="brand">
        <span className="brand-icon" aria-hidden="true">
          {d.brandMark}
        </span>
        <span className="brand-text">
          {d.brandName}
          <small>{d.brandTagline}</small>
        </span>
        <div className="lang-switch" role="group" aria-label={d.langAria}>
          <button
            type="button"
            className={locale === 'fa' ? 'active' : undefined}
            aria-pressed={locale === 'fa'}
            onClick={() => setLocale('fa')}
          >
            فارسی
          </button>
          <button
            type="button"
            className={locale === 'en' ? 'active' : undefined}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            English
          </button>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer>{d.footer}</footer>
    </>
  );
}
