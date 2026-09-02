"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { RiLockLine } from "@remixicon/react";
import { useAuth, type AuthUser } from "@/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProtectedRouteProps = {
  children: React.ReactNode;
  /** Where to redirect if not authenticated (default: /login) */
  redirectTo?: string;
  /** Optional fallback shown while the auth check is in progress */
  fallback?: React.ReactNode;
  /** Restrict the route to these roles. Any signed-in user is allowed if omitted. */
  allowedRoles?: AuthUser["role"][];
  /** Where to send a signed-in user whose role is not allowed (default: /) */
  forbiddenRedirectTo?: string;
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
 * Pass `allowedRoles` to also gate on role:
 *
 * ```tsx
 * <ProtectedRoute allowedRoles={["seller", "admin"]}>
 *   <ListingForm mode="create" />
 * </ProtectedRoute>
 * ```
 *
 * While the auth rehydration check is in flight it renders `fallback`.
 * Once complete, an anonymous visitor is redirected to `redirectTo` and a
 * signed-in visitor without an allowed role to `forbiddenRedirectTo`.
 */
export default function ProtectedRoute({
  children,
  redirectTo = "/login",
  fallback = <DefaultFallback />,
  allowedRoles,
  forbiddenRedirectTo = "/",
}: ProtectedRouteProps) {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const roleAllowed =
    !allowedRoles || (user !== null && allowedRoles.includes(user.role));

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      // Without this the user signs in and lands on the home page, and the link they
      // followed is gone from history because this is a replace.
      const returnTo = `${pathname}${window.location.search}`;
      router.replace(`${redirectTo}?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    if (!roleAllowed) {
      router.replace(forbiddenRedirectTo);
    }
  }, [
    loading,
    isAuthenticated,
    roleAllowed,
    router,
    redirectTo,
    forbiddenRedirectTo,
    pathname,
  ]);

  // Still checking — show placeholder
  if (loading) return <>{fallback}</>;

  // Not authenticated, or not allowed here — render nothing while the redirect
  // is in flight
  if (!isAuthenticated || !roleAllowed) return null;

  return <>{children}</>;
}
