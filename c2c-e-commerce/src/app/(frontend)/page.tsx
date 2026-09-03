import type { Metadata } from "next";
import Link from "next/link";

import CategoryBoard from "@/components/categories/CategoryBoard";
import RecommendedForYou from "@/components/RecommendedForYou";

export const metadata: Metadata = {
  title: "Home",
};

const PRIMARY_LINK =
  "inline-flex items-center justify-center gap-2.5 border-[1.5px] border-ink bg-ink px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white no-underline transition-colors hover:border-black hover:bg-black";

const SECONDARY_LINK =
  "inline-flex items-center justify-center gap-2.5 border-[1.5px] border-ink px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-ink hover:text-white";

/**
 * The three beats of an order, which is the one sequence in this product where the
 * order genuinely carries information: a listing goes nowhere until the seller
 * confirms, and nothing is reviewable until it completes. Numbered for that reason
 * and not as decoration.
 */
const STEPS = [
  {
    number: "01",
    title: "List it in a minute",
    body: "Title, price, one photo. If the words will not come, the description assistant drafts them from what you have already typed.",
  },
  {
    number: "02",
    title: "Agree with the seller",
    body: "An order stays pending until the seller confirms it. Neither side is committed before the other one is.",
  },
  {
    number: "03",
    title: "Close it out",
    body: "Mark it shipped, then completed. Buyers who completed an order can review the seller they bought from.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16 py-4">
      {/* Hero */}
      <section className="grid items-end gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
        <div className="flex flex-col gap-5">
          <span className="eyebrow text-ink-3">
            Five categories · person to person
          </span>
          <h1 className="max-w-[15ch] text-5xl leading-[0.94] sm:text-6xl lg:text-[76px]">
            Somebody already owns what you need.
          </h1>
        </div>

        <div className="flex flex-col gap-7 lg:pb-1.5">
          <p className="max-w-[44ch] text-lg text-ink-2">
            Nobody here runs a shop. Every listing is one person clearing out one thing
            they are finished with — and describing it in their own words, which is
            exactly how you can search for it.
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <Link href="/listings" className={PRIMARY_LINK}>
              Browse listings
            </Link>
            <Link href="/listings/new" className={SECONDARY_LINK}>
              Sell an item
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={15}
                height={15}
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12h14" />
                <path d="m12 6 6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* The market directory. Renders nothing until the categories load. */}
      <CategoryBoard />

      {/* How an order actually works */}
      <section className="grid gap-10 sm:grid-cols-3">
        {STEPS.map(({ number, title, body }) => (
          <div key={number} className="flex flex-col gap-3 border-t-[3px] border-ink pt-4">
            <span className="figure text-[40px] leading-none">{number}</span>
            <h2 className="text-2xl">{title}</h2>
            <p className="max-w-[38ch] text-sm text-ink-2">{body}</p>
          </div>
        ))}
      </section>

      {/* Client component: renders nothing for anonymous visitors, and nothing when there
          is nothing to recommend (AI-10 AC8). */}
      <RecommendedForYou />
    </div>
  );
}
