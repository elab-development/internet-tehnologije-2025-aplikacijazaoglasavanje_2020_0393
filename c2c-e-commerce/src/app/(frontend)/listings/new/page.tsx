"use client";

import ListingForm from "@/components/listings/ListingForm";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function CreateListingPage() {
  return (
    <ProtectedRoute allowedRoles={["seller", "admin"]}>
      <ListingForm mode="create" />
    </ProtectedRoute>
  );
}
