import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
};

/** Metadata carrier only — the page below stays a client component. */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
