"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import toast from "react-hot-toast";
import { RiStoreLine, RiLoginBoxLine } from "@remixicon/react";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import InputField from "@/components/ui/InputField";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { oauthErrorMessage } from "@/lib/oauth/error-messages";

// Note: metadata export is ignored in client components — title is set in
// the nearest server layout. Keep it here as documentation intent.
export const _metadata: Pick<Metadata, "title"> = { title: "Login" };

// ─── Component ────────────────────────────────────────────────────────────────

function LoginPageContent() {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The OAuth callback redirects here with ?error=<code> on every failure path. An
  // unknown code maps to null and renders nothing, rather than putting a value from
  // the query string on the page.
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  const returnTo = searchParams.get("returnTo") ?? undefined;

  // Redirect already-authenticated users away from login
  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace("/");
  }, [authLoading, isAuthenticated, router]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Field-level validation ────────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  function validate(): boolean {
    const errs: typeof fieldErrors = {};
    if (!email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs.email = "Enter a valid email address";
    if (!password) errs.password = "Password is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Welcome back!");
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <RiStoreLine size={28} />
            </span>
            <h1 className="text-2xl font-bold text-zinc-900">Welcome back</h1>
            <p className="text-sm text-zinc-500">Sign in to your C2C Market account</p>
          </div>

          {/* Global error banner */}
          {error && <ErrorAlert message={error} className="mb-5" />}
          {!error && oauthError && <ErrorAlert message={oauthError} className="mb-5" />}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <InputField
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
              required
              autoComplete="email"
            />

            <InputField
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
              required
              autoComplete="current-password"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              loading={submitting}
              icon={<RiLoginBoxLine size={18} />}
              className="mt-2"
            >
              Sign in
            </Button>
          </form>

          <OAuthButtons returnTo={returnTo} />

          {/* Footer link */}
          <p className="mt-6 text-center text-sm text-zinc-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// Suspense boundary for useSearchParams (Next 16 requires one in every page that reads
// them). The fallback is a skeleton of the same card shell so there is no layout jump
// between this and the real form.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4">
          <div className="w-full max-w-md animate-pulse">
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
              <div className="mb-8 flex flex-col items-center gap-2 text-center">
                <span className="h-12 w-12 rounded-xl bg-zinc-100" />
                <span className="h-6 w-40 rounded bg-zinc-100" />
                <span className="h-4 w-56 rounded bg-zinc-100" />
              </div>
              <div className="flex flex-col gap-4">
                <span className="h-10 w-full rounded-lg bg-zinc-100" />
                <span className="h-10 w-full rounded-lg bg-zinc-100" />
                <span className="mt-2 h-10 w-full rounded-lg bg-zinc-100" />
              </div>
            </div>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
