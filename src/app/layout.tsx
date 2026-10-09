import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import './globals.css';
import {
  dictionaries,
  localeDirection,
  normalizeLocale,
  LOCALE_COOKIE,
} from '@/i18n';
import { LocaleProvider } from '@/i18n/locale-provider';
import { Chrome } from '@/components/chrome';

// Self-hosted Vazirmatn (SIL OFL 1.1): Persian-first UI font, no CDN requests.
const vazirmatn = localFont({
  src: [
    { path: '../../public/fonts/Vazirmatn-Regular.woff2', weight: '400' },
    { path: '../../public/fonts/Vazirmatn-Bold.woff2', weight: '700' },
  ],
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  const d = dictionaries[locale];
  return {
    title: d.metaTitle,
    description: d.metaDescription,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}
export const dynamic = 'force-dynamic';
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <html
      lang={locale}
      dir={localeDirection[locale]}
      className={vazirmatn.className}
    >
      <body>
        <LocaleProvider initialLocale={locale}>
          <Chrome>{children}</Chrome>
        </LocaleProvider>
      </body>
    </html>
  );
}
