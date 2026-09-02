"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RiErrorWarningLine } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/**
 * Segment error boundary.
 *
 * Every page under (frontend) is a client component, so a render-time throw used to
 * unwind to the root and replace the whole document with Next's bare "Application
 * error" screen — no navbar, no footer, no link back. This keeps the app's chrome and
 * offers both a retry and a way on.
 */
export default function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this with the server log; the message itself is
    // not user-facing copy — it can carry internal details like a DB host.
    console.error("Unhandled render error", error.digest ?? error);
  }, [error]);

  return (
    <EmptyState
      icon={<RiErrorWarningLine size={28} aria-hidden="true" />}
      title="Something went wrong"
      description="The page could not be displayed. Trying again often works; if it does not, head back to the marketplace."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/listings">
            <Button variant="secondary">Browse listings</Button>
          </Link>
        </div>
      }
    />
  );
}
