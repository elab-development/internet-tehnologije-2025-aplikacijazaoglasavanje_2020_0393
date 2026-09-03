import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register",
};

/** Metadata carrier only — the page below stays a client component. */
export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
