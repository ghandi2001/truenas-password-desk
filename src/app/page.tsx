'use client';
import Link from 'next/link';
import { useLocale } from '@/i18n/locale-provider';
export default function Home() {
  const { d } = useLocale();
  return (
    <section className="card narrow">
      <p className="eyebrow">{d.home.eyebrow}</p>
      <h1>
        {d.home.headingTop}
        <br />
        {d.home.headingBottom}
      </h1>
      <p>{d.home.intro}</p>
      <Link className="button" href="/admin">
        {d.home.adminLink}
      </Link>
    </section>
  );
}
