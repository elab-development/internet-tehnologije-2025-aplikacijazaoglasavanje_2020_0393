"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: "buyer" | "seller" | "admin";
  phoneNumber: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterPayload) => Promise<void>;
  logout: () => void;
};

type RegisterPayload = {
  email: string;
  password: string;
  name: string;
  role?: "buyer" | "seller";
  phoneNumber?: string;
};

// The endpoints also return a `token` for API clients; the browser client
// deliberately ignores it and relies on the httpOnly cookie instead.
type AuthResponse = {
  user: AuthUser;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // The session lives in an httpOnly cookie this code cannot read, so the only
  // way to know whether one exists is to ask the server. A 401 simply means not
  // logged in.
  useEffect(() => {
    api
      .get<{ user: AuthUser }>("/api/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<AuthResponse>("/api/auth/login", {
      email,
      password,
    });
    setUser(data.user);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await api.post<AuthResponse>("/api/auth/register", payload);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    // The server clears the cookie; clear local state regardless so the UI does
    // not keep showing a signed-in user if that request fails.
    api
      .post("/api/auth/logout")
      .catch(() => {})
      .finally(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated: !!user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
