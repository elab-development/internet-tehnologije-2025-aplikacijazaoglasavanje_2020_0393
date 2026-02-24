"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

/**
 * Redirects to /login if the user is not authenticated.
 *
 * Call this at the top of any page that requires authentication:
 *
 * ```tsx
 * export default function OrdersPage() {
 *   const { user, loading } = useRequireAuth();
 *   if (loading) return <LoadingSpinner />;
 *   // user is guaranteed non-null here
 * }
 * ```
 *
 * Returns the full auth context so the caller can destructure user/token.
 */
export function useRequireAuth(redirectTo = "/login") {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Wait until the session rehydration check is done before redirecting
    if (!auth.loading && !auth.isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [auth.loading, auth.isAuthenticated, router, redirectTo]);

  return auth;
}
