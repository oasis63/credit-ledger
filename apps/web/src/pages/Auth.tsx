import { Link, useNavigate } from 'react-router-dom';
import { api, type User } from '../api';
import { useAuth } from '../auth';
import { AsyncForm } from '../components';

type AuthResponse = { token: string; user: User };

export function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  return (
    <div className="auth">
      <h1>Sign in</h1>
      <AsyncForm
        submitLabel="Sign in"
        onSubmit={async (f) => {
          const r = await api<AuthResponse>('/api/auth/login', {
            method: 'POST',
            auth: false,
            body: { email: f.get('email'), password: f.get('password') },
          });
          signIn(r.token, r.user);
          nav(r.user.role === 'salesman' ? '/collections' : '/');
        }}
      >
        <label>
          Email <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </AsyncForm>
      <p>
        New business? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}

export function Register() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  return (
    <div className="auth">
      <h1>Create your business account</h1>
      <AsyncForm
        submitLabel="Create account"
        onSubmit={async (f) => {
          const r = await api<AuthResponse>('/api/auth/register', {
            method: 'POST',
            auth: false,
            body: {
              businessName: f.get('businessName'),
              name: f.get('name'),
              email: f.get('email'),
              password: f.get('password'),
            },
          });
          signIn(r.token, r.user);
          nav('/settings');
        }}
      >
        <label>
          Business name <input name="businessName" required maxLength={200} />
        </label>
        <label>
          Your name <input name="name" required maxLength={100} />
        </label>
        <label>
          Email <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password (10+ characters) <input name="password" type="password" minLength={10} autoComplete="new-password" required />
        </label>
      </AsyncForm>
      <p>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
