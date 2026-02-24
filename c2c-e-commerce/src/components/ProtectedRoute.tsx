"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiLockLine } from "@remixicon/react";
import { useAuth } from "@/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProtectedRouteProps = {
  children: React.ReactNode;
  /** Where to redirect if not authenticated (default: /login) */
  redirectTo?: string;
  /** Optional fallback shown while the auth check is in progress */
  fallback?: React.ReactNode;
};

// ─── Default loading fallback ─────────────────────────────────────────────────

function DefaultFallback() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
      <RiLockLine size={40} />
      <p className="text-sm">Checking authentication…</p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wrap any page or section that requires authentication.
 *
 * ```tsx
 * <ProtectedRoute>
 *   <OrdersPage />
 * </ProtectedRoute>
 * ```
 *
 * While the auth rehydration check is in flight it renders `fallback`.
 * Once complete, if the user is not authenticated it redirects to `redirectTo`.
 */
export default function ProtectedRoute({
  children,
  redirectTo = "/login",
  fallback = <DefaultFallback />,
}: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [loading, isAuthenticated, router, redirectTo]);

  // Still checking — show placeholder
  if (loading) return <>{fallback}</>;

  // Not authenticated — render nothing while the redirect is in flight
  if (!isAuthenticated) return null;

  return <>{children}</>;
}
