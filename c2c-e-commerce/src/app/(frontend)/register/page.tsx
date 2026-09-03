"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { RiStoreLine, RiUserAddLine } from "@remixicon/react";
import { useAuth } from "@/context/AuthContext";
import AuthPageShell from "@/components/auth/AuthPageShell";
import Button from "@/components/ui/Button";
import ErrorAlert from "@/components/ui/ErrorAlert";
import FormErrorSummary, { type FieldError } from "@/components/ui/FormErrorSummary";
import InputField from "@/components/ui/InputField";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { looksLikeEmail } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "buyer" | "seller";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const { register, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect already-authenticated users away from register
  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace("/");
  }, [authLoading, isAuthenticated, router]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("buyer");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Mirrors fieldErrors for FormErrorSummary. A plain state value (set once per
  // validate() call) rather than a value derived at render time, so its identity stays
  // stable across the re-renders every keystroke causes — otherwise the summary's
  // focus effect would fire on every keystroke and steal focus back from the field the
  // user is trying to fix.
  const [fieldErrorList, setFieldErrorList] = useState<FieldError[]>([]);

  const roleRefs = useRef<Record<Role, HTMLButtonElement | null>>({
    buyer: null,
    seller: null,
  });

  // Roving tabindex means only the checked option is in the tab order, so the arrow-key
  // handler has to move focus itself as it moves the selection — otherwise Tab would land
  // on an option that arrow keys can no longer reach.
  function selectRole(next: Role) {
    setRole(next);
    roleRefs.current[next]?.focus();
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: FieldErrors = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!email.trim()) errs.email = "Email is required";
    else if (!looksLikeEmail(email)) errs.email = "Enter a valid email address";
    if (!password) errs.password = "Password is required";
    else if (password.length < 8)
      errs.password = "Password must be at least 8 characters";

    const list: FieldError[] = [];
    if (errs.name) list.push({ field: "name", message: errs.name });
    if (errs.email) list.push({ field: "email", message: errs.email });
    if (errs.password) list.push({ field: "password", message: errs.password });

    setFieldErrors(errs);
    setFieldErrorList(list);
    return list.length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
      });
      toast.success("Account created. Welcome to C2C Market.");
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AuthPageShell
      icon={<RiStoreLine size={28} aria-hidden="true" />}
      title="Create an account"
      subtitle="Join C2C Market and start buying or selling"
      wrapperClassName="py-10"
      footer={
        <p className="mt-6 text-center text-sm text-ink-3">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-ink hover:text-black hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      {/* Global error banner */}
      {error && <ErrorAlert message={error} className="mb-5" />}

      {fieldErrorList.length > 0 && (
        <div className="mb-5">
          <FormErrorSummary errors={fieldErrorList} />
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <InputField
          id="name"
          label="Full name"
          type="text"
          placeholder="Jane Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
          required
          autoComplete="name"
        />

        <InputField
          id="email"
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
          id="password"
          label="Password"
          type="password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
          autoComplete="new-password"
        />

        <InputField
          label="Phone number (optional)"
          type="tel"
          placeholder="+1 555 000 0000"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          autoComplete="tel"
        />

        {/* Role selector */}
        <div className="flex flex-col gap-2">
          <span id="role-label" className="eyebrow text-ink-2">
            I want to&hellip;
            <span className="ml-0.5 text-stop" aria-hidden="true">*</span>
          </span>
          <div
            role="radiogroup"
            aria-labelledby="role-label"
            aria-required="true"
            className="grid grid-cols-2 gap-2"
          >
            {(["buyer", "seller"] as Role[]).map((r) => (
              <button
                key={r}
                ref={(el) => {
                  roleRefs.current[r] = el;
                }}
                type="button"
                role="radio"
                aria-checked={role === r}
                tabIndex={role === r ? 0 : -1}
                onClick={() => selectRole(r)}
                onKeyDown={(event) => {
                  if (
                    event.key === "ArrowRight" ||
                    event.key === "ArrowDown" ||
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    selectRole(r === "buyer" ? "seller" : "buyer");
                  }
                }}
                className={[
                  "flex items-center justify-center gap-2 border-[1.5px] px-3 py-3 text-sm font-bold uppercase tracking-[0.06em] transition-colors",
                  role === r
                    ? "border-ink bg-ink text-white"
                    : "border-rule-strong bg-white text-ink-2 hover:border-ink",
                ].join(" ")}
              >
                {/* Decoration next to a labelled control; unhidden it made the
                    accessible name "shopping bags Buy". */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={16}
                  height={16}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {r === "buyer" ? (
                    <>
                      <path d="M5 7.5h14L18 20H6Z" />
                      <path d="M9 9.5v-3a3 3 0 0 1 6 0v3" />
                    </>
                  ) : (
                    <>
                      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
                      <path d="M4 9.5a2.4 2.4 0 0 0 4 1.6 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4-1.6" />
                      <path d="M5.5 11.8V20h13v-8.2" />
                    </>
                  )}
                </svg>
                {r === "buyer" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          fullWidth
          loading={submitting}
          icon={<RiUserAddLine size={18} />}
          className="mt-2"
        >
          Create account
        </Button>
      </form>

      <OAuthButtons />
    </AuthPageShell>
  );
}
