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
        "skeleton-shimmer rounded-none",
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
      className="flex flex-col overflow-hidden rounded-none border border-rule bg-white shadow-none"
    >
      {/* image area */}
      <div className="skeleton-shimmer h-48 w-full" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="border-t border-rule px-4 py-3 flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-8 w-14 rounded-none" />
      </div>
    </div>
  );
}

/** Skeleton for an order card row */
export function OrderCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-none border border-rule bg-white shadow-none"
    >
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="border-t border-rule px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20 rounded-none" />
        </div>
        <Skeleton className="h-8 w-16 rounded-none" />
      </div>
    </div>
  );
}

/** Skeleton for the listing detail page */
export function ListingDetailSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="rounded-none border border-rule bg-white p-6 shadow-none space-y-4">
        <Skeleton className="h-6 w-24 rounded-none" />
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
          <Skeleton className="h-10 w-28 rounded-none" />
          <Skeleton className="h-10 w-28 rounded-none" />
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-24 rounded-none" />
        <Skeleton className="h-24 rounded-none" />
      </div>
    </div>
  );
}
