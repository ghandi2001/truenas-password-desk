'use client';
import { useState } from 'react';
import { useLocale } from '@/i18n/locale-provider';
import { fill, msg, translateError, type Message } from '@/i18n';
/** Thrown with the server's raw error string; rendered via Notice, which translates. */
export class ApiError extends Error {}
/** Client-side validation failure carrying the message to render. */
export class LocalError extends Error {
  constructor(public message2: Message) {
    super('LocalError');
  }
}
export async function api(path: string, body?: unknown, csrf?: string) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(typeof data.error === 'string' ? data.error : '');
  return data;
}
/** Localize a caught error for display: known API errors translate, anything else falls back. */
export function errorMessage(e: unknown): Message {
  if (e instanceof LocalError) return e.message2;
  if (e instanceof ApiError && e.message) return { raw: e.message };
  return msg('apiFallback');
}
export function PasswordField({
  label,
  name,
  autoComplete = 'new-password',
}: {
  label: string;
  name: string;
  autoComplete?: string;
}) {
  const { d } = useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={name}>{label}</label>
      <span className="password-input">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          required
          maxLength={512}
          autoComplete={autoComplete}
          dir="ltr"
        />
        <button
          type="button"
          className="quiet"
          aria-label={fill(visible ? d.field.hideAria : d.field.showAria, {
            label: label.toLowerCase(),
          })}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? d.field.hide : d.field.show}
        </button>
      </span>
    </div>
  );
}
export function Notice({ message }: { message: Message | null }) {
  const { d } = useLocale();
  if (!message) return <p className="notice" />;
  const text =
    'raw' in message
      ? translateError(message.raw, d)
      : fill(d.messages[message.key], message.params);
  return (
    <p role="status" aria-live="polite" className="notice">
      {text}
    </p>
  );
}
