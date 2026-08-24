import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { User } from '../types';

interface AuthContextValue {
  loading: boolean;
  currentUser: User | null;
  canEdit: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCurrentUser(await api.auth.me());
    } catch (err) {
      // A 401 here just means "not logged in" - anything else is a real, unexpected failure.
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    setCurrentUser(await api.auth.login(username, password));
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setCurrentUser(null);
  }, []);

  const canEdit = currentUser ? currentUser.is_admin || currentUser.can_edit : false;

  const value: AuthContextValue = { loading, currentUser, canEdit, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
