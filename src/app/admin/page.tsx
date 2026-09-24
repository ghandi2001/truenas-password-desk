'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, PasswordField, Notice } from '@/components/forms';
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
const date = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
export default function Admin() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [links, setLinks] = useState<LinkRow[]>([]),
    [logs, setLogs] = useState<AuditRow[]>([]),
    [url, setUrl] = useState('');
  const refresh = useCallback(async () => {
    const s = await api('admin/session');
    setSession(s);
    const [l, a] = await Promise.all([
      api('admin/password-links'),
      api('admin/audit-logs'),
    ]);
    setLinks(l.links);
    setLogs(a.logs);
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
    setMessage('');
    try {
      await api('admin/login', {
        username: data.get('username'),
        password: data.get('password'),
      });
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to sign in.');
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setBusy(true);
    setMessage('');
    setUrl('');
    try {
      const result = await api(
        'admin/password-links',
        {
          username: d.get('username'),
          minutes: Number(d.get('minutes')),
          note: d.get('note'),
        },
        session?.csrf,
      );
      setUrl(result.url);
      form.reset();
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to create link.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setMessage('');
    try {
      await api(`admin/password-links/${id}/revoke`, {}, session?.csrf);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to revoke link.');
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
      setMessage('Signed out.');
    } catch {
      setMessage('Unable to sign out. Try again.');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Notice text="Loading your workspace…" />;
  if (!session)
    return (
      <section className="card narrow">
        <p className="eyebrow">ADMINISTRATOR ACCESS</p>
        <h1>Welcome back.</h1>
        <p>Manage temporary password links in one private workspace.</p>
        <Notice text={message} />
        <form onSubmit={login}>
          <fieldset disabled={busy}>
            <label>
              Admin username
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={64}
              />
            </label>
            <PasswordField
              name="password"
              label="Admin password"
              autoComplete="current-password"
            />
            <button>{busy ? 'Signing in…' : 'Sign in securely'}</button>
          </fieldset>
        </form>
        <p className="hint">
          No default account. Your operator creates administrator access from
          the server.
        </p>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Password links</h1>
          <p>
            Signed in as {session.username}. Create access, not shared
            passwords.
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={logout}>
          Sign out
        </button>
      </div>
      <Notice text={message} />
      <div className="workspace">
        <section className="card">
          <h2>Create a secure link</h2>
          <p>Bound to one local SMB username. No account lookup is exposed.</p>
          <form onSubmit={create}>
            <fieldset disabled={busy}>
              <label>
                TrueNAS username
                <input
                  name="username"
                  required
                  pattern="[a-zA-Z0-9_][a-zA-Z0-9_.\-]*"
                  maxLength={64}
                  autoComplete="off"
                />
              </label>
              <label>
                Expires after (minutes)
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
                Internal note{' '}
                <span className="hint">(optional, no secrets)</span>
                <textarea name="note" maxLength={200} rows={3} />
              </label>
              <button>{busy ? 'Working…' : 'Generate one-time link'}</button>
            </fieldset>
          </form>
        </section>
        <section className="card">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>One person. One change.</h2>
          <ol className="steps">
            <li>Create a link for a specific account.</li>
            <li>Send it through a trusted private channel.</li>
            <li>The user confirms their current password.</li>
            <li>A successful change closes the link.</li>
          </ol>
          {url && (
            <div className="issued">
              <h3>Copy now—shown only once</h3>
              <label>
                Generated password-change link
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <div className="actions">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setMessage('Link copied. Send it privately.');
                    } catch {
                      setMessage('Select the link and copy it manually.');
                    }
                  }}
                >
                  Copy link
                </button>
                <button className="secondary" onClick={() => setUrl('')}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <section className="card">
        <div className="page-heading">
          <div>
            <h2>Recent links</h2>
            <p>Latest 200 links. Status is refreshed on request.</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              refresh().catch(() =>
                setMessage('Unable to refresh. Sign in again.'),
              )
            }
          >
            Refresh
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              Password-change links and lifecycle
            </caption>
            <thead>
              <tr>
                {[
                  'Account / note',
                  'Status',
                  'Created / creator',
                  'Expires',
                  'Used',
                  'Action',
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
                    <strong>{l.username}</strong>
                    <small>{l.note}</small>
                  </td>
                  <td>
                    <span className="badge">{l.status}</span>
                  </td>
                  <td>
                    {date(l.createdAt)}
                    <small>{l.creator}</small>
                  </td>
                  <td>{date(l.expiresAt)}</td>
                  <td>{date(l.usedAt)}</td>
                  <td>
                    {l.status === 'Active' ? (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => revoke(l.id)}
                        aria-label={`Revoke link for ${l.username}`}
                      >
                        Revoke
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!links.length && <p>No links yet. Create your first one above.</p>}
        </div>
        <p className="hint">
          “Needs review” means an operation is in progress or its outcome is
          uncertain. An operator must reconcile it; it is never retried
          automatically.
        </p>
      </section>
      <section className="card">
        <h2>Audit trail</h2>
        <p>Latest 200 events. Passwords and raw links are never recorded.</p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Security audit events</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Result</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{date(l.createdAt)}</td>
                  <td>{l.action.replaceAll('_', ' ')}</td>
                  <td>{l.status}</td>
                  <td>{l.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
