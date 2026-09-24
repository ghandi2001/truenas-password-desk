'use client';
import { useState } from 'react';
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
    throw new Error(data.error ?? 'Unable to complete the request.');
  return data;
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
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="password-input">
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          required
          maxLength={512}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="quiet"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}
export function Notice({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" className="notice">
      {text}
    </p>
  );
}
