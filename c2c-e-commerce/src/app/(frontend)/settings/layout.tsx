import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  // Behind ProtectedRoute, but a crawler reaching it would otherwise index the
  // redirect-to-login screen under a real title.
  robots: { index: false },
};

/** Metadata carrier only — the page below stays a client component. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
