"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

// Disable SSR – swagger-ui-react accesses browser-only APIs (`window`,
// `document`) at render time.  Without `ssr: false` Next.js attempts to
// pre-render the component on the server, which produces a hydration
// mismatch and silently breaks all client-side event handlers (including
// the "Execute" button).
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

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
