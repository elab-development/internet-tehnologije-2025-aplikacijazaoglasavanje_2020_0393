"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import { Skeleton } from "@/components/ui";
import { useAnnounce } from "@/components/ui/Announcer";

// L21: the swagger-ui-react bundle is large and previously rendered nothing while it
// loaded, so the page sat blank. This is `next/dynamic`'s own `loading` slot, so it
// covers both the initial chunk fetch and, per Next's docs, a slow `import()` on
// navigation back to the page.
function ApiDocsLoading() {
  const announce = useAnnounce();

  useEffect(() => {
    announce("Loading API documentation…");
  }, [announce]);

  return (
    <div className="space-y-4 px-4 py-8 sm:px-6" aria-hidden="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-64 w-full rounded-none" />
    </div>
  );
}

// Disable SSR – swagger-ui-react accesses browser-only APIs (`window`,
// `document`) at render time.  Without `ssr: false` Next.js attempts to
// pre-render the component on the server, which produces a hydration
// mismatch and silently breaks all client-side event handlers (including
// the "Execute" button).
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: ApiDocsLoading,
});

export default function ApiDocsPage() {
  return (
    <div className="-mx-4 sm:-mx-6">
      <SwaggerUI
        url="/api/docs"
        persistAuthorization
      />
    </div>
  );
}
