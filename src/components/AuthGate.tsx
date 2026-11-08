import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LogOut, RefreshCw, Server, Store } from 'lucide-react';
import { ApiError } from '../lib/api';
import { ROLE_LABELS } from '../domain/permissions';
import { useApp } from '../store/AppStore';
import { useAuth } from '../store/AuthContext';

const SEED_PASSWORD = 'Storehouse123!';

const SEED_ACCOUNTS = [
  { label: 'Owner', name: 'David Akwu', phone: '+2348030001001' },
  { label: 'Manager', name: 'Ngozi Okafor', phone: '+2348030001002' },
  { label: 'Cashier', name: 'Chinedu Obi', phone: '+2348030001006' },
];

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function AuthFrame({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">
            <Store size={22} />
          </span>
          <div>
            <div className="auth-brand__name">Storehouse</div>
            <div className="auth-brand__sub">Inventory control</div>
          </div>
        </div>
        {children}
        <div className="auth-caption">
          <Server size={13} /> {caption}
        </div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const { login, connectionError, retry } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone.trim() || !password) {
      setError('Enter your phone number and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(phone.trim(), password);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const fill = (seedPhone: string) => {
    setPhone(seedPhone);
    setPassword(SEED_PASSWORD);
    setError(null);
  };

  return (
    <AuthFrame caption="Signed in against the Storehouse API on this network.">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-card__head">
          <div className="eyebrow">Server sign-in</div>
          <h2>Open the store</h2>
          <p className="muted small mt-4">
            Use the phone number and password on your staff account. Roles and permissions come from the server.
          </p>
        </div>

        {(connectionError || error) && (
          <div className="banner banner--danger" role="alert">
            <span>{error ?? connectionError}</span>
            {connectionError && !error && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={retry}>
                <RefreshCw size={13} /> Retry
              </button>
            )}
          </div>
        )}

        <div className="auth-form">
          <div className="field">
            <label htmlFor="login-phone">Phone number</label>
            <input
              id="login-phone"
              className="input"
              inputMode="tel"
              autoComplete="username"
              placeholder="+2348030001001"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>

        <button className="btn btn--primary auth-submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="auth-quick">
          <div className="auth-quick__label">Seeded accounts · password {SEED_PASSWORD}</div>
          <div className="flex gap-6 flex-wrap">
            {SEED_ACCOUNTS.map((account) => (
              <button
                key={account.phone}
                type="button"
                className="btn btn--sm"
                onClick={() => fill(account.phone)}
                title={account.name}
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </AuthFrame>
  );
}

function ChangePasswordScreen() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError('The new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame caption="Temporary passwords must be replaced before the store opens.">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-card__head">
          <div className="eyebrow">Password change required</div>
          <h2>Choose a new password</h2>
          <p className="muted small mt-4">
            {user?.name} ({user ? ROLE_LABELS[user.role] : ''}) is signed in with a temporary password.
          </p>
        </div>

        {error && (
          <div className="banner banner--danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="auth-form">
          <div className="field">
            <label htmlFor="current-password">Temporary password</label>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <span className="field__hint">At least 8 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
        </div>

        <button className="btn btn--primary auth-submit" type="submit" disabled={busy}>
          <KeyRound size={15} /> {busy ? 'Saving…' : 'Save new password'}
        </button>
        <button type="button" className="btn btn--ghost auth-signout" onClick={logout}>
          <LogOut size={14} /> Sign out instead
        </button>
      </form>
    </AuthFrame>
  );
}

function ConnectingScreen() {
  return (
    <AuthFrame caption="Checking your saved session…">
      <div className="card auth-card auth-card--center" role="status">
        <span className="auth-spinner" />
        <h2>Connecting to Storehouse</h2>
        <p className="muted small mt-4">Revalidating your session with the server.</p>
      </div>
    </AuthFrame>
  );
}

function SessionSync({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { actions } = useApp();

  useEffect(() => {
    if (user) actions.signInServerUser(user);
  }, [user, actions]);

  return <>{children}</>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, mustChangePassword } = useAuth();

  if (status === 'checking') return <ConnectingScreen />;
  if (status !== 'authenticated' || !user) return <LoginScreen />;
  if (mustChangePassword) return <ChangePasswordScreen />;
  return <SessionSync>{children}</SessionSync>;
}
