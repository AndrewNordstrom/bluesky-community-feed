import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../api/client';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  userDid: string | null;
  userHandle: string | null;
  login: (handle: string, appPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userDid, setUserDid] = useState<string | null>(null);
  const [userHandle, setUserHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    const token = localStorage.getItem('accessJwt');
    if (!token) {
      setIsAuthenticated(false);
      setUserDid(null);
      setUserHandle(null);
      setIsLoading(false);
      return;
    }

    try {
      const session = await authApi.getSession();
      setIsAuthenticated(session.authenticated);
      setUserDid(session.did);
      setUserHandle(session.handle);
      setError(null);
    } catch (err) {
      // Session invalid or expired
      localStorage.removeItem('accessJwt');
      localStorage.removeItem('userDid');
      localStorage.removeItem('userHandle');
      setIsAuthenticated(false);
      setUserDid(null);
      setUserHandle(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (handle: string, appPassword: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login(handle, appPassword);

      // Store session info
      localStorage.setItem('accessJwt', response.accessJwt);
      localStorage.setItem('userDid', response.did);
      localStorage.setItem('userHandle', response.handle);

      setIsAuthenticated(true);
      setUserDid(response.did);
      setUserHandle(response.handle);
    } catch (err: any) {
      const message =
        err.response?.data?.message || err.message || 'Authentication failed';
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);

    try {
      await authApi.logout();
    } catch (err) {
      // Ignore logout errors
    }

    // Clear local storage
    localStorage.removeItem('accessJwt');
    localStorage.removeItem('userDid');
    localStorage.removeItem('userHandle');

    setIsAuthenticated(false);
    setUserDid(null);
    setUserHandle(null);
    setError(null);
    setIsLoading(false);
  }, []);

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    userDid,
    userHandle,
    login,
    logout,
    checkSession,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
