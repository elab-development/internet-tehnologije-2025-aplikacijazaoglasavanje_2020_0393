// ─── Skeleton loader primitives ──────────────────────────────────────────────
// Use these to build skeleton screens while data is loading.

type SkeletonProps = {
  className?: string;
};

/** Single skeleton block with shimmer animation */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={[
        "skeleton-shimmer rounded-lg",
        className,
      ].join(" ")}
    />
  );
}

/** Skeleton that looks like a listing Card */
export function ListingCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      {/* image area */}
      <div className="skeleton-shimmer h-48 w-full" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="border-t border-zinc-100 px-4 py-3 flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-8 w-14 rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton for an order card row */
export function OrderCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="border-t border-zinc-100 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-16 rounded-lg" />
      </div>
    </div>
  );
}

/** Skeleton for the listing detail page */
export function ListingDetailSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    </div>
  );
}
