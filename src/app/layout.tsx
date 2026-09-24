import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Password Desk',
  description: 'Secure self-service password changes',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="brand">
          <span className="brand-icon" aria-hidden="true">
            P
          </span>
          <span>
            Password Desk<small>PRIVATE ACCESS · SECURE CHANGES</small>
          </span>
        </header>
        <main id="main">{children}</main>
        <footer>
          Your credentials stay private. Your current password is always
          required.
        </footer>
      </body>
    </html>
  );
}
