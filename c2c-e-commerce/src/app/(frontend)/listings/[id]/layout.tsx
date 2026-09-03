import type { Metadata } from "next";

import { listingForMetadata } from "@/lib/listing-metadata";

/**
 * Server component, deliberately — this is what lets it call into `@/db` (spec D10) and
 * export `generateMetadata`, neither of which the client page below it may do.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await listingForMetadata(Number(id));

  if (!listing) {
    // Not publicly visible, or not there. Generic title, and keep it out of the index.
    return { title: "Listing", robots: { index: false } };
  }

  return {
    title: listing.title,
    description: listing.description.slice(0, 160),
    openGraph: {
      title: listing.title,
      description: listing.description.slice(0, 160),
    },
  };
}

/** Metadata carrier only — the page below stays a client component. */
export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
