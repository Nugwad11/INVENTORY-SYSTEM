import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  api,
  clearStoredToken,
  readStoredToken,
  storeToken,
  type ServerUser,
} from '../lib/api';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  token: string | null;
  user: ServerUser | null;
  mustChangePassword: boolean;
  connectionError: string | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (readStoredToken() ? 'checking' : 'anonymous'));
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<ServerUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const adopt = useCallback((nextToken: string, nextUser: ServerUser, pendingChange: boolean) => {
    storeToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setMustChangePassword(pendingChange);
    setConnectionError(null);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setConnectionError(null);
    setStatus('anonymous');
  }, []);

  const validate = useCallback(async (storedToken: string) => {
    setStatus('checking');
    setConnectionError(null);
    try {
      const result = await api.me(storedToken);
      setToken(storedToken);
      setUser(result.user);
      setMustChangePassword(result.mustChangePassword);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredToken();
        setToken(null);
        setUser(null);
        setStatus('anonymous');
        return;
      }
      setStatus('anonymous');
      setConnectionError(messageOf(error));
    }
  }, []);

  useEffect(() => {
    const stored = readStoredToken();
    if (stored) void validate(stored);
  }, [validate]);

  const login = useCallback(
    async (phone: string, password: string) => {
      setConnectionError(null);
      try {
        const result = await api.login(phone, password);
        adopt(result.token, result.user, result.mustChangePassword);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'NETWORK') setConnectionError(messageOf(error));
        throw error;
      }
    },
    [adopt],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!token) throw new Error('Sign in again to change the password.');
      await api.changePassword(token, currentPassword, newPassword);
      setMustChangePassword(false);
    },
    [token],
  );

  const retry = useCallback(() => {
    const stored = readStoredToken();
    if (stored) {
      void validate(stored);
      return;
    }
    setConnectionError(null);
  }, [validate]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, token, user, mustChangePassword, connectionError, login, logout, changePassword, retry }),
    [status, token, user, mustChangePassword, connectionError, login, logout, changePassword, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
