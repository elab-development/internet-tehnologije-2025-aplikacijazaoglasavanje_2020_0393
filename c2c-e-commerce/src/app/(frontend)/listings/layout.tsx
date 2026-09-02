import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse listings",
};

/**
 * Metadata carrier only — the page below stays a client component.
 *
 * Also wraps `listings/[id]` and `listings/new`; each of those segments carries its own
 * `layout.tsx` whose metadata overrides this one, which is the intended nesting.
 */
export default function ListingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
