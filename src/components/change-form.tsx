'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, PasswordField, Notice, LocalError, errorMessage } from './forms';
import { useLocale } from '@/i18n/locale-provider';
import { fill, msg, type Message } from '@/i18n';
export default function ChangeForm({ token }: { token: string }) {
  const { d } = useLocale();
  const [minimum, setMinimum] = useState<number | null>(null),
    [message, setMessage] = useState<Message | null>(msg('checking')),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    api('password-change/' + encodeURIComponent(token))
      .then((r) => {
        if (live) {
          setMinimum(r.minLength);
          setMessage(null);
        }
      })
      .catch((e) => {
        if (live) setMessage(errorMessage(e));
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
    setMessage(null);
    try {
      const newPassword = String(data.get('newPassword')),
        confirmPassword = String(data.get('confirmPassword'));
      if (newPassword !== confirmPassword)
        throw new LocalError(msg('mismatch'));
      if ([...newPassword].length < (minimum ?? 8))
        throw new LocalError(msg('tooShort', { min: minimum ?? 8 }));
      await api('password-change/' + encodeURIComponent(token), {
        newPassword,
        confirmPassword,
      });
      setDone(true);
      setMessage(msg('changed'));
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">{d.change.eyebrow}</p>
      <h1>{done ? d.change.allSet : d.change.strong}</h1>
      <p>{d.change.intro}</p>
      <Notice message={message} />
      {minimum && !done && (
        <form onSubmit={submit}>
          <p className="hint">{fill(d.change.policyHint, { min: minimum })}</p>
          <fieldset disabled={busy}>
            <PasswordField name="newPassword" label={d.change.new} />
            <PasswordField name="confirmPassword" label={d.change.confirm} />
            <button type="submit">
              {busy ? d.change.submitting : d.change.submit}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
