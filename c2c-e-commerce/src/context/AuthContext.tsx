"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "@/lib/api";

/**
 * How long after a successful refresh to schedule the next one.
 *
 * Two minutes inside the access token's 15-minute life (JWT_EXPIRES_IN, C2C-SEC-3), so
 * an idle tab renews before it lapses instead of discovering the expiry through a failed
 * request the user is waiting on.
 */
const PROACTIVE_REFRESH_MS = 13 * 60 * 1000;

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
  const router = useRouter();

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

  // The API client refreshes silently on a 401 (lib/api.ts). This fires only when that
  // refresh failed too -- the session is genuinely gone, so stop showing a signed-in UI
  // and send the user somewhere they can do something about it.
  useEffect(() => {
    api.onAuthLost(() => {
      setUser(null);
      router.push("/login");
    });

    // Without this, an unmounted provider's handler would still hold a stale router
    // and redirect on behalf of a tree that no longer exists.
    return () => api.onAuthLost(null);
  }, [router]);

  // Proactive refresh. Renewing on a timer rather than waiting for a 401 means an idle
  // tab does not make the user's next click pay for the round trip. Only while signed
  // in: refreshing for a visitor who never logged in is a guaranteed 401 on a loop.
  useEffect(() => {
    if (!user) return;

    const timer = setInterval(() => {
      // A failure here is not fatal: the token is still valid for another two minutes,
      // and the 401 path will refresh again if this was a transient blip.
      api.post("/api/auth/refresh").catch(() => {});
    }, PROACTIVE_REFRESH_MS);

    return () => clearInterval(timer);
  }, [user]);

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
