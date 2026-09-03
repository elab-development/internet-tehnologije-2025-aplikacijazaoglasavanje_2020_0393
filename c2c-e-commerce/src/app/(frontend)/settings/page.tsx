"use client";

import LinkedAccounts from "@/components/auth/LinkedAccounts";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";

/**
 * Account settings (C2C-SEC-8 AC10).
 *
 * Currently just the linked-accounts section; the page exists because that section
 * needed somewhere to live, and it is the natural home for password changes and the
 * deferred "sign out other devices" screen (SEC-3) when those land.
 */
export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Account settings</h1>
          {user && (
            <p className="mt-1 text-sm text-ink-3">
              Signed in as {user.email}
            </p>
          )}
        </header>

        <LinkedAccounts />
      </div>
    </ProtectedRoute>
  );
}
