"use client";

import { RiLinksLine } from "@remixicon/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import InputField from "@/components/ui/InputField";
import { api } from "@/lib/api";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
};

/**
 * The account-linking challenge (C2C-SEC-8, decision D9).
 *
 * Reached only from the OAuth callback, which has already established that a *verified*
 * provider email matches an existing password account. That match is not proof of
 * ownership — a provider can hand over any address — so the account's own password is
 * what authorises the link.
 *
 * This page holds no token. The challenge is in an httpOnly cookie the server set and
 * this code cannot read; all the page does is collect the password.
 */
export default function LinkAccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const provider = searchParams.get("provider") ?? "";
  const providerLabel = PROVIDER_LABELS[provider] ?? "your account";
  const returnTo = searchParams.get("returnTo") ?? "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError("Enter your password to continue.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/auth/oauth/link", { password });
      toast.success(`${providerLabel} linked to your account`);
      // A full reload so AuthContext picks up the session the link just issued.
      window.location.assign(returnTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not link the account");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <RiLinksLine size={28} aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold text-zinc-900">Link your account</h1>
            {/* Says plainly why they are here rather than signed in. */}
            <p className="text-sm text-zinc-500">
              An account with this email already exists. Enter its password to connect
              it to {providerLabel}.
            </p>
          </div>

          {error && <ErrorAlert message={error} className="mb-5" />}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <InputField
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              loading={submitting}
            >
              Link account
            </Button>
          </form>

          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-6 w-full text-center text-sm font-medium text-zinc-500 hover:text-zinc-700 hover:underline"
          >
            Cancel and sign in with a password instead
          </button>
        </div>
      </div>
    </div>
  );
}
