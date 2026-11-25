import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Banknote, MessageCircle, ShieldCheck } from 'lucide-react';
import { api, type User } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field } from '../ui';

type AuthResponse = { token: string; user: User };

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="brand"><div className="brand-mark">₹</div><div className="brand-name">Credit Ledger</div></div>
        <h2>Get paid faster by the shops you supply.</h2>
        <ul>
          <li><MessageCircle size={18} />WhatsApp statements and reminders that shops actually open</li>
          <li><Banknote size={18} />Field collections with instant receipts, no missing cash</li>
          <li><BadgeCheck size={18} />GST bills with UPI QR, straight into your bank</li>
          <li><ShieldCheck size={18} />A ledger that can't be edited behind your back</li>
        </ul>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function useSubmit(fn: (f: FormData) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, onSubmit };
}

export function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await api<AuthResponse>('/api/auth/login', { method: 'POST', auth: false, body: { email: f.get('email'), password: f.get('password') } });
    signIn(r.token, r.user);
    nav(r.user.role === 'salesman' ? '/field' : '/');
  });
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your business account.">
      <form onSubmit={onSubmit} className="form-stack">
        <Field label="Email"><input name="email" type="email" autoComplete="email" required autoFocus /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="auth-alt">New business? <Link to="/register">Create an account</Link></p>
    </AuthShell>
  );
}

export function Register() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const { busy, error, onSubmit } = useSubmit(async (f) => {
    const r = await api<AuthResponse>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { businessName: f.get('businessName'), name: f.get('name'), email: f.get('email'), password: f.get('password') },
    });
    signIn(r.token, r.user);
    nav('/settings');
  });
  return (
    <AuthShell title="Create your account" subtitle="Free to start. Set up takes two minutes.">
      <form onSubmit={onSubmit} className="form-stack">
        <Field label="Business name"><input name="businessName" required maxLength={200} autoFocus /></Field>
        <Field label="Your name"><input name="name" required maxLength={100} /></Field>
        <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" hint="At least 10 characters"><input name="password" type="password" minLength={10} autoComplete="new-password" required /></Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="auth-alt">Already registered? <Link to="/login">Sign in</Link></p>
    </AuthShell>
  );
}
