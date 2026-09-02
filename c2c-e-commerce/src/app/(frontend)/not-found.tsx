import Link from "next/link";
import { RiCompass3Line } from "@remixicon/react";

import { Button, EmptyState } from "@/components/ui";

/** 404 inside the app shell, rather than the framework's chrome-less default. */
export default function NotFound() {
  return (
    <EmptyState
      icon={<RiCompass3Line size={28} aria-hidden="true" />}
      title="Page not found"
      description="That link does not lead anywhere. It may have been removed, or the address may be mistyped."
      action={
        <Link href="/listings">
          <Button>Browse listings</Button>
        </Link>
      }
    />
  );
}
