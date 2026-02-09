import { createContext } from 'react';

export interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  userDid: string | null;
  userHandle: string | null;
  login: (handle: string, appPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  error: string | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
