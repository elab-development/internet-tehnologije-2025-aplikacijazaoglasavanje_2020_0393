"use client";

import { useRouter } from "next/navigation";
import { RiCompass3Line } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/**
 * 404 inside the app shell, rather than the framework's chrome-less default.
 *
 * The action used to be a `<Link>` wrapping a `<Button>` -- an anchor's content model
 * forbids interactive descendants, so that was invalid HTML and put two focusable
 * stops with the same accessible name behind one action. This matches the
 * `Button` + `router.push` pattern every other `EmptyState` CTA in this codebase
 * already uses (orders/page.tsx, listings/page.tsx, SellerListingsTab.tsx).
 */
export default function NotFound() {
  const router = useRouter();

  return (
    <>
      {/* EmptyState's own title renders as an <h2> (four other consumers rely on that
          staying an h2), and this page renders nothing else -- so without a top-level
          heading here the page has an h2 with no h1 above it, the same shape H8 named
          as a defect on /listings. Visually hidden because EmptyState's icon + title
          already say this on screen; this just gives the page a real h1 in the tree. */}
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<RiCompass3Line size={28} aria-hidden="true" />}
        title="Page not found"
        description="That link does not lead anywhere. It may have been removed, or the address may be mistyped."
        action={
          <Button onClick={() => router.push("/listings")}>Browse listings</Button>
        }
      />
    </>
  );
}
