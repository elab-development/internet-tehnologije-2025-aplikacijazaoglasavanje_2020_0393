import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API documentation",
};

/** Metadata carrier only — the page below stays a client component. */
export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
