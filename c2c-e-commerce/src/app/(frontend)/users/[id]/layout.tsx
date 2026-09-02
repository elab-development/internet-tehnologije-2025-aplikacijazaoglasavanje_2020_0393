import type { Metadata } from "next";

import { sellerForMetadata } from "@/lib/listing-metadata";

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
  const seller = await sellerForMetadata(Number(id));

  if (!seller) {
    return { title: "Seller", robots: { index: false } };
  }

  return { title: seller.name };
}

/** Metadata carrier only — the page below stays a client component. */
export default function SellerProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
