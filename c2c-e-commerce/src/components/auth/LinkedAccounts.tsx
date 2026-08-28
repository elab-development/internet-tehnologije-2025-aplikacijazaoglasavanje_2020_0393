"use client";

import { RiGithubFill, RiGoogleFill } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import ErrorAlert from "@/components/ui/ErrorAlert";
import { api } from "@/lib/api";

type ProviderName = "google" | "github";

const PROVIDERS: Record<ProviderName, { label: string; Icon: typeof RiGoogleFill }> = {
  google: { label: "Google", Icon: RiGoogleFill },
  github: { label: "GitHub", Icon: RiGithubFill },
};

type Me = { linkedProviders: ProviderName[]; hasPassword: boolean };

/**
 * Manage which external identities are attached to this account (C2C-SEC-8 AC10).
 *
 * The last-credential rule is enforced on the server (409 from the unlink route) and
 * mirrored here so the user sees *why* before they click, not after. The mirror is a
 * convenience, never the control: `hasPassword` and the provider list both come from
 * the server on every render.
 */
export default function LinkedAccounts() {
  const [me, setMe] = useState<Me | null>(null);
  const [available, setAvailable] = useState<ProviderName[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProviderName | null>(null);

  const load = useCallback(async () => {
    const [{ user }, { providers }] = await Promise.all([
      api.get<{ user: Me }>("/api/auth/me"),
      api.get<{ providers: ProviderName[] }>("/api/auth/providers"),
    ]);
    setMe(user);
    setAvailable(providers);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Could not load your linked accounts."));
  }, [load]);

  if (!me) return null;

  async function disconnect(provider: ProviderName) {
    setError(null);
    setBusy(provider);
    try {
      await api.delete(`/api/auth/oauth/link/${provider}`);
      toast.success(`${PROVIDERS[provider].label} disconnected`);
      await load();
    } catch (err: unknown) {
      // The server's message is the actionable one ("set a password first"), so it is
      // shown rather than replaced with a generic failure.
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-zinc-900">Linked accounts</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Sign in with these providers instead of your password.
      </p>

      {error && <ErrorAlert message={error} className="mt-4" />}

      <ul className="mt-4 flex flex-col gap-3">
        {available.map((provider) => {
          const { label, Icon } = PROVIDERS[provider];
          const linked = me!.linkedProviders.includes(provider);

          // Would this leave the account with no way in at all?
          const isLastCredential =
            linked && !me!.hasPassword && me!.linkedProviders.length === 1;

          return (
            <li
              key={provider}
              data-testid={`provider-${provider}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                <Icon size={18} aria-hidden="true" />
                {label}
                <span className="text-xs font-normal text-zinc-500">
                  {linked ? "Connected" : "Not connected"}
                </span>
              </span>

              {isLastCredential && (
                <span className="w-full text-xs text-amber-700">
                  This is your only way to sign in. Set a password before disconnecting it.
                </span>
              )}

              <button
                type="button"
                disabled={busy !== null || isLastCredential}
                onClick={() =>
                  linked
                    ? disconnect(provider)
                    : window.location.assign(`/api/auth/oauth/${provider}`)
                }
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {/* The provider is in the label, not just the row: "Disconnect" alone
                    is ambiguous when announced out of context. */}
                {linked ? `Disconnect ${label}` : `Connect ${label}`}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
