import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { BrandLockup } from '../components/Brand';

export function LoginRoute() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('admin@visahobe.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div className="glass-strong" style={{ width: 'min(420px, 100%)', padding: 24 }}>
        <div className="mb">
          <BrandLockup />
        </div>

        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await signIn(email, password);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <div className="small" style={{ color: 'var(--red)' }}>
              {error}
            </div>
          )}
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="small muted mt" style={{ lineHeight: 1.5 }}>
          Self-hosted deployment. Credentials are defined by the administrator of this instance.
        </p>
      </div>
    </div>
  );
}
