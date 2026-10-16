import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'viewer';
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => undefined,
  signOut: async () => undefined,
  refresh: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await api.get<{ user: CurrentUser }>('/api/auth/me');
      setUser(current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api.post('/api/auth/login', { email, password });
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut, refresh }), [user, loading, signIn, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
