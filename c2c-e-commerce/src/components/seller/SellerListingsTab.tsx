"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { RiStoreLine } from "@remixicon/react";
import SellerListingCard from "@/components/seller/SellerListingCard";
import { Button, EmptyState, ErrorAlert } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api } from "@/lib/api";
import type { Listing, ListingsResponse } from "@/types/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SellerListingsTabProps = {
  formatConverted: (amount: number) => string;
};

// ─── Component ────────────────────────────────────────────────────────────────

/** The "My Listings" tab of the seller dashboard. */
export default function SellerListingsTab({
  formatConverted,
}: SellerListingsTabProps) {
  const router = useRouter();
  const { user } = useAuth();

  // Null until the session rehydrates — useFetch waits rather than requesting
  // every seller's listings.
  const { data, setData, loading, error } = useFetch<ListingsResponse>(
    user ? `/api/listings?sellerId=${user.id}&limit=100` : null,
  );
  const listings = data?.data ?? [];

  const [updatingListingId, setUpdatingListingId] = useState<number | null>(
    null,
  );

  function replaceListings(next: (current: Listing[]) => Listing[]) {
    setData((current) =>
      current ? { ...current, data: next(current.data) } : current,
    );
  }

  async function handleDelete(listingId: number) {
    if (!window.confirm("Are you sure you want to delete this listing?")) return;

    try {
      await api.delete(`/api/listings/${listingId}`);
      replaceListings((current) =>
        current.filter((listing) => listing.id !== listingId),
      );
      toast.success("Listing deleted");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete listing";
      toast.error(msg);
    }
  }

  async function handleStatusToggle(listingId: number, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "removed" : "active";

    try {
      setUpdatingListingId(listingId);
      await api.put(`/api/listings/${listingId}`, { status: newStatus });
      replaceListings((current) =>
        current.map((listing) =>
          listing.id === listingId
            ? { ...listing, status: newStatus }
            : listing,
        ),
      );
      toast.success(
        `Listing ${newStatus === "active" ? "activated" : "disabled"}`,
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update listing";
      toast.error(msg);
    } finally {
      setUpdatingListingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} />}

      <div className="flex justify-end">
        <Button onClick={() => router.push("/listings/new")}>
          + New Listing
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-zinc-100" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={<RiStoreLine size={32} />}
          title="No listings yet"
          description="Create your first listing to start selling."
          action={
            <Button onClick={() => router.push("/listings/new")}>
              Create Listing
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <SellerListingCard
              key={listing.id}
              listing={listing}
              formatConverted={formatConverted}
              updating={updatingListingId === listing.id}
              canDelete={user?.role === "admin"}
              onOpen={() => router.push(`/listings/${listing.id}/edit`)}
              onToggleStatus={() =>
                handleStatusToggle(listing.id, listing.status)
              }
              onDelete={() => handleDelete(listing.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
