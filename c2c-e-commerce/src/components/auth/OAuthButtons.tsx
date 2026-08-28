"use client";

import { RiGithubFill, RiGoogleFill } from "@remixicon/react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

type ProviderName = "google" | "github";

const PROVIDERS: Record<ProviderName, { label: string; Icon: typeof RiGoogleFill }> = {
  google: { label: "Google", Icon: RiGoogleFill },
  github: { label: "GitHub", Icon: RiGithubFill },
};

export type OAuthButtonsProps = {
  /** Same-site path to return to after signing in. */
  returnTo?: string;
};

/**
 * "Continue with …" buttons for whichever providers this deployment has configured.
 *
 * The list comes from the server rather than from `NEXT_PUBLIC_*` variables: the
 * registry already decides what is configured (SEC-6 AC10), and duplicating that rule
 * in the client is how the two drift apart and a button appears for a provider whose
 * route answers 404.
 */
export default function OAuthButtons({ returnTo }: OAuthButtonsProps) {
  const [providers, setProviders] = useState<ProviderName[]>([]);
  const [pending, setPending] = useState<ProviderName | null>(null);

  useEffect(() => {
    let active = true;

    api
      .get<{ providers: ProviderName[] }>("/api/auth/providers")
      .then(({ providers }) => {
        if (active) setProviders(providers);
      })
      // Rendering no buttons is the right failure: a button that cannot work is worse
      // than an absent one, and the password form beside it still functions.
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  if (providers.length === 0) return null;

  function start(provider: ProviderName) {
    setPending(provider);

    const url = returnTo
      ? `/api/auth/oauth/${provider}?returnTo=${encodeURIComponent(returnTo)}`
      : `/api/auth/oauth/${provider}`;

    // A full navigation, not fetch: the provider answers with a redirect to its own
    // consent screen, which the user has to actually see.
    window.location.assign(url);
  }

  return (
    <div className="mt-6">
      <div className="relative mb-4 flex items-center">
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        {/* Text, not just a rule: the divider is what says these are alternatives. */}
        <span className="px-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          or
        </span>
        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>

      <div data-testid="oauth-buttons" className="flex flex-col gap-3">
        {providers.map((provider) => {
          const { label, Icon } = PROVIDERS[provider];

          return (
            <button
              key={provider}
              type="button"
              // Disabled across the whole group while one is in flight: a second click
              // would start a second transaction and discard the first one's cookie.
              disabled={pending !== null}
              onClick={() => start(provider)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon size={18} aria-hidden="true" />
              {pending === provider ? `Redirecting to ${label}…` : `Continue with ${label}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
