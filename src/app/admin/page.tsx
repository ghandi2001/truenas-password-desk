'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, PasswordField, Notice, errorMessage } from '@/components/forms';
import { UserSelect } from '@/components/user-select';
import { useLocale } from '@/i18n/locale-provider';
import { fill, formatDate, localeTag, msg, type Message } from '@/i18n';
type Session = { username: string; csrf: string; defaultMinutes: number };
type LinkRow = {
  id: string;
  username: string;
  note: string;
  creator: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  status: string;
};
type AuditRow = {
  id: string;
  action: string;
  status: string;
  createdAt: string;
  ipAddress: string;
  linkId: string | null;
};
export default function Admin() {
  const { locale, d } = useLocale();
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<Message | null>(null),
    [links, setLinks] = useState<LinkRow[]>([]),
    [logs, setLogs] = useState<AuditRow[]>([]),
    [url, setUrl] = useState(''),
    [smbUsers, setSmbUsers] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    const s = await api('admin/session');
    setSession(s);
    const [l, a, u] = await Promise.all([
      api('admin/password-links'),
      api('admin/audit-logs'),
      api('admin/smb-users').catch(() => ({ users: [] })),
    ]);
    setLinks(l.links);
    setLogs(a.logs);
    setSmbUsers(u.users ?? []);
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([
      api('admin/session'),
      api('admin/password-links'),
      api('admin/audit-logs'),
    ])
      .then(([s, l, a]) => {
        if (live) {
          setSession(s);
          setLinks(l.links);
          setLogs(a.logs);
        }
        return s ? api('admin/smb-users').catch(() => ({ users: [] })) : null;
      })
      .then((u) => {
        if (live && u?.users) setSmbUsers(u.users);
      })
      .catch(() => {
        if (live) setSession(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);
    try {
      await api('admin/login', {
        username: data.get('username'),
        password: data.get('password'),
      });
      await refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d2 = new FormData(form);
    setBusy(true);
    setMessage(null);
    setUrl('');
    try {
      const result = await api(
        'admin/password-links',
        {
          username: d2.get('username'),
          minutes: Number(d2.get('minutes')),
          note: d2.get('note'),
        },
        session?.csrf,
      );
      setUrl(result.url);
      form.reset();
      await refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(`admin/password-links/${id}/revoke`, {}, session?.csrf);
      await refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api('admin/logout', {}, session?.csrf);
      setSession(null);
      setLinks([]);
      setLogs([]);
      setUrl('');
      setMessage(msg('signedOut'));
    } catch {
      setMessage(msg('signOutFailed'));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p className="notice">{d.admin.loading}</p>;
  if (!session)
    return (
      <section className="card narrow">
        <p className="eyebrow">{d.admin.loginEyebrow}</p>
        <h1>{d.admin.welcome}</h1>
        <p>{d.admin.loginIntro}</p>
        <Notice message={message} />
        <form onSubmit={login}>
          <fieldset disabled={busy}>
            <label>
              {d.admin.usernameLabel}
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={64}
                dir="ltr"
              />
            </label>
            <PasswordField
              name="password"
              label={d.admin.passwordLabel}
              autoComplete="current-password"
            />
            <button>{busy ? d.admin.signingIn : d.admin.signIn}</button>
          </fieldset>
        </form>
        <p className="hint">{d.admin.noDefault}</p>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{d.admin.workspaceEyebrow}</p>
          <h1>{d.admin.linksHeading}</h1>
          <p>{fill(d.admin.signedInAs, { username: session.username })}</p>
        </div>
        <button className="secondary" disabled={busy} onClick={logout}>
          {d.admin.signOut}
        </button>
      </div>
      <Notice message={message} />
      <div className="workspace">
        <section className="card">
          <h2>{d.admin.createHeading}</h2>
          <p>{d.admin.createIntro}</p>
          <form onSubmit={create}>
            <fieldset disabled={busy}>
              <label>
                {d.admin.nasUsername}
                <UserSelect
                  users={smbUsers}
                  name="username"
                  label={d.admin.nasUsername}
                />
                <span className="hint">
                  {smbUsers.length
                    ? fill(d.admin.smbCount, {
                        count: new Intl.NumberFormat(localeTag[locale]).format(
                          smbUsers.length,
                        ),
                      })
                    : d.admin.smbUnavailable}
                </span>
              </label>
              <label>
                {d.admin.expiresAfter}
                <input
                  name="minutes"
                  type="number"
                  min={1}
                  max={1440}
                  defaultValue={session.defaultMinutes}
                  required
                />
              </label>
              <label>
                {d.admin.noteLabel}{' '}
                <span className="hint">{d.admin.noteHint}</span>
                <textarea name="note" maxLength={200} rows={3} />
              </label>
              <button>{busy ? d.admin.working : d.admin.generate}</button>
            </fieldset>
          </form>
        </section>
        <section className="card">
          <p className="eyebrow">{d.admin.howEyebrow}</p>
          <h2>{d.admin.howHeading}</h2>
          <ol className="steps">
            {d.admin.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {url && (
            <div className="issued">
              <h3>{d.admin.copyNow}</h3>
              <label>
                {d.admin.generatedLinkLabel}
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  dir="ltr"
                />
              </label>
              <div className="actions">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setMessage(msg('copied'));
                    } catch {
                      setMessage(msg('copyManual'));
                    }
                  }}
                >
                  {d.admin.copyLink}
                </button>
                <button className="secondary" onClick={() => setUrl('')}>
                  {d.admin.dismiss}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <section className="card">
        <div className="page-heading">
          <div>
            <h2>{d.admin.recentHeading}</h2>
            <p>{d.admin.recentIntro}</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              refresh().catch(() => setMessage(msg('refreshFailed')))
            }
          >
            {d.admin.refresh}
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">{d.admin.tableCaption}</caption>
            <thead>
              <tr>
                {[
                  d.admin.thAccount,
                  d.admin.thStatus,
                  d.admin.thCreated,
                  d.admin.thExpires,
                  d.admin.thUsed,
                  d.admin.thAction,
                ].map((s) => (
                  <th key={s} scope="col">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong dir="ltr">{l.username}</strong>
                    <small>{l.note}</small>
                  </td>
                  <td>
                    <span className="badge">
                      {d.statuses[l.status] ?? l.status}
                    </span>
                  </td>
                  <td>
                    {formatDate(l.createdAt, locale)}
                    <small dir="ltr">{l.creator}</small>
                  </td>
                  <td>{formatDate(l.expiresAt, locale)}</td>
                  <td>{formatDate(l.usedAt, locale)}</td>
                  <td>
                    {l.status === 'Active' ? (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => revoke(l.id)}
                        aria-label={fill(d.admin.revokeAria, {
                          username: l.username,
                        })}
                      >
                        {d.admin.revoke}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!links.length && <p>{d.admin.noLinks}</p>}
        </div>
        <p className="hint">{d.admin.needsReviewHint}</p>
      </section>
      <section className="card">
        <h2>{d.admin.auditHeading}</h2>
        <p>{d.admin.auditIntro}</p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">{d.admin.auditCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{d.admin.thTime}</th>
                <th scope="col">{d.admin.thEvent}</th>
                <th scope="col">{d.admin.thResult}</th>
                <th scope="col">{d.admin.thSource}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.createdAt, locale)}</td>
                  <td>
                    {d.auditActions[l.action] ?? l.action.replaceAll('_', ' ')}
                  </td>
                  <td>{d.auditStatuses[l.status] ?? l.status}</td>
                  <td dir="ltr">{l.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
