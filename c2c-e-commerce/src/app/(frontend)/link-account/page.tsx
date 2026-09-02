"use client";

import { RiLinksLine } from "@remixicon/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import AuthPageShell from "@/components/auth/AuthPageShell";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import InputField from "@/components/ui/InputField";
import { api } from "@/lib/api";
import { safeReturnTo } from "@/lib/oauth/return-to";

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
function LinkAccountPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const provider = searchParams.get("provider") ?? "";
  const providerLabel = PROVIDER_LABELS[provider] ?? "your account";
  // Sanitised again on the client. The callback already ran this before putting the
  // value in the URL, but a URL is not a trusted channel -- anyone can craft
  // /link-account?returnTo=https://evil.test, and this value reaches location.assign.
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

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
    <AuthPageShell
      icon={<RiLinksLine size={28} aria-hidden="true" />}
      title="Link your account"
      // Says plainly why they are here rather than signed in.
      subtitle={`An account with this email already exists. Enter its password to connect it to ${providerLabel}.`}
      headerClassName="mb-6"
      footer={
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-6 w-full text-center text-sm font-medium text-zinc-500 hover:text-zinc-700 hover:underline"
        >
          Cancel and sign in with a password instead
        </button>
      }
    >
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
    </AuthPageShell>
  );
}

// Suspense boundary for useSearchParams (Next 16 requires one in every page that reads
// them). The fallback is a skeleton of the same card shell so there is no layout jump
// between this and the real form.
export default function LinkAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
          <div className="w-full max-w-md animate-pulse">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <div className="mb-6 flex flex-col items-center gap-2 text-center">
                <span className="h-12 w-12 rounded-xl bg-zinc-100" />
                <span className="h-6 w-48 rounded bg-zinc-100" />
                <span className="h-4 w-64 rounded bg-zinc-100" />
              </div>
              <div className="flex flex-col gap-4">
                <span className="h-10 w-full rounded-lg bg-zinc-100" />
                <span className="mt-2 h-10 w-full rounded-lg bg-zinc-100" />
              </div>
            </div>
          </div>
        </div>
      }
    >
      <LinkAccountPageContent />
    </Suspense>
  );
}
