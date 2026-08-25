"use client";

import { useParams, useRouter } from "next/navigation";
import ListingForm from "@/components/listings/ListingForm";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button, ErrorAlert } from "@/components/ui";

function EditListingContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const listingId = Number(params.id);

  if (!Number.isInteger(listingId) || listingId <= 0) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <ErrorAlert message="Invalid listing id" />
        <Button variant="secondary" onClick={() => router.push("/listings")}>
          Back to listings
        </Button>
      </div>
    );
  }

  return <ListingForm mode="edit" listingId={listingId} />;
}

export default function EditListingPage() {
  return (
    <ProtectedRoute allowedRoles={["seller", "admin"]}>
      <EditListingContent />
    </ProtectedRoute>
  );
}
