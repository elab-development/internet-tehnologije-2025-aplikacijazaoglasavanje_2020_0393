import type { Metadata } from "next";
import { RiStoreLine, RiSearchLine, RiShoppingBagLine } from "@remixicon/react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Home",
};

// ─── Placeholder home page ────────────────────────────────────────────────────
// The feature/listings branch will replace this with the real browse UI.

export default function HomePage() {
  return (
    <div className="flex flex-col items-center gap-10 py-16 text-center">
      {/* Hero */}
      <div className="flex flex-col items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
          <RiStoreLine size={36} />
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
          Welcome to C2C Market
        </h1>
        <p className="max-w-lg text-lg text-zinc-500">
          Your peer-to-peer marketplace. Browse listings, connect with sellers,
          and sell your own items in minutes.
        </p>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/listings"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <RiSearchLine size={18} />
          Browse Listings
        </Link>
        <Link
          href="/orders"
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 px-5 py-2.5 text-sm font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
        >
          <RiShoppingBagLine size={18} />
          My Orders
        </Link>
      </div>

      {/* Feature cards */}
      <div className="mt-4 grid w-full max-w-3xl gap-6 sm:grid-cols-3">
        {[
          {
            icon: <RiSearchLine size={24} />,
            title: "Discover Items",
            body: "Search, filter, and sort through hundreds of listings.",
          },
          {
            icon: <RiStoreLine size={24} />,
            title: "Sell Anything",
            body: "Create a listing in seconds and reach buyers instantly.",
          },
          {
            icon: <RiShoppingBagLine size={24} />,
            title: "Easy Orders",
            body: "Place and track orders through a simple checkout flow.",
          },
        ].map(({ icon, title, body }) => (
          <div
            key={title}
            className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              {icon}
            </span>
            <h2 className="font-semibold text-zinc-900">{title}</h2>
            <p className="text-sm text-zinc-500">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
