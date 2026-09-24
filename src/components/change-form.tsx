'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, PasswordField, Notice } from './forms';
export default function ChangeForm({ token }: { token: string }) {
  const [minimum, setMinimum] = useState<number | null>(null),
    [message, setMessage] = useState('Checking your secure link…'),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    api('password-change/' + encodeURIComponent(token))
      .then((d) => {
        if (live) {
          setMinimum(d.minLength);
          setMessage('');
        }
      })
      .catch(() => {
        if (live)
          setMessage(
            'This link is unavailable. Ask your administrator for a new link.',
          );
      });
    return () => {
      live = false;
    };
  }, [token]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const currentPassword = String(data.get('currentPassword')),
        newPassword = String(data.get('newPassword')),
        confirmPassword = String(data.get('confirmPassword'));
      if (newPassword !== confirmPassword)
        throw Error('New passwords must match.');
      if ([...newPassword].length < (minimum ?? 12))
        throw Error(`Use at least ${minimum} characters.`);
      await api('password-change/' + encodeURIComponent(token), {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setDone(true);
      setMessage('Your password has been changed. You can close this page.');
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'The password could not be changed.',
      );
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">ONE-TIME PASSWORD CHANGE</p>
      <h1>
        {done ? 'You’re all set.' : 'Make your next password a strong one.'}
      </h1>
      <p>
        This link changes only the account assigned by your administrator. Your
        current password confirms it is you.
      </p>
      <Notice text={message} />
      {minimum && !done && (
        <form onSubmit={submit}>
          <p className="hint">
            Use at least {minimum} characters, up to 512 UTF-8 bytes. Choose a
            unique passphrase—not your username, current password, a common
            password, or repeated characters. Spaces are preserved; NUL is not
            accepted. Your organization may enforce additional rules.
          </p>
          <fieldset disabled={busy}>
            <PasswordField
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
            />
            <PasswordField name="newPassword" label="New password" />
            <PasswordField
              name="confirmPassword"
              label="Confirm new password"
            />
            <button type="submit">
              {busy ? 'Changing password…' : 'Change my password'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
