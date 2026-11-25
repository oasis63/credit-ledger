import { useState, type FormEvent, type ReactNode } from 'react';

/** Small form helpers used by the public statement page. */
export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

/** Form wrapper that handles busy state and errors for async submit handlers. */
export function AsyncForm({
  onSubmit,
  children,
  submitLabel,
  className,
}: {
  onSubmit: (data: FormData) => Promise<void>;
  children: ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(new FormData(form));
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className={className ?? 'form'}>
      {children}
      <ErrorNote error={error} />
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
