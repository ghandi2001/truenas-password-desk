'use client';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useLocale } from '@/i18n/locale-provider';

/** Searchable username picker: filter-as-you-type dropdown over NAS SMB users.
 *  Free text still allowed — validation stays on the input pattern. */
export function UserSelect({
  users,
  name,
  label,
}: {
  users: string[];
  name: string;
  label: string;
}) {
  const { d } = useLocale();
  const listId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = useMemo(
    () =>
      users.filter((u) => u.toLowerCase().includes(query.trim().toLowerCase())),
    [users, query],
  );
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  function choose(u: string) {
    setQuery(u);
    setOpen(false);
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && users.length) return setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && open) {
      if (filtered.length) {
        e.preventDefault();
        choose(filtered[Math.min(active, filtered.length - 1)]);
      } else setOpen(false);
    }
  }
  return (
    <span className="user-select" ref={wrapRef}>
      <input
        ref={inputRef}
        id={name}
        name={name}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (users.length) setOpen(true);
        }}
        onFocus={() => {
          if (users.length) setOpen(true);
        }}
        onKeyDown={key}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[active] ? `${listId}-${active}` : undefined
        }
        aria-label={label}
        required
        pattern="[a-zA-Z0-9_][a-zA-Z0-9_.\-]*"
        maxLength={64}
        autoComplete="off"
        dir="ltr"
      />
      {users.length > 0 && (
        <button
          type="button"
          className="quiet user-select-toggle"
          aria-label={d.admin.showOptions}
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          ▾
        </button>
      )}
      {open && users.length > 0 && (
        <span
          className="user-select-list"
          id={listId}
          role="listbox"
          aria-label={label}
        >
          {filtered.map((u, i) => (
            <span
              key={u}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={false}
              className={i === active ? 'active' : undefined}
              onPointerEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(u)}
              dir="ltr"
            >
              {u}
            </span>
          ))}
          {!filtered.length && (
            <span className="user-select-empty" role="status">
              {d.admin.noMatch}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
