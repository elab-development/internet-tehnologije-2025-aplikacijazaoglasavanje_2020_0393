import { NextRequest } from "next/server";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, listings, orders, users } from "@/db/schema";
import { isLeafCategory } from "@/db/categories";
import { listImagesFor, toImageSummary } from "@/db/listing-images";
import { hasLiveOrder } from "@/db/orders";
import { canMutateListing, isAdmin } from "@/lib/authorization";
import { authenticate, authorize, AuthError } from "@/lib/middleware";
import { isPubliclyVisible } from "@/lib/listing-visibility";
import { listingColumns } from "@/lib/listings-query";
import {
  computeListingEmbedding,
  needsReembedding,
  type EmbeddingOutcome,
} from "@/lib/ai/listing-embedding";
import { jsonError, jsonOk } from "@/lib/response";
import { parseResourceId } from "@/lib/params";
import { parseRequest, UpdateListingSchema } from "@/lib/validation";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

// ─── Helpers ──────────────────────────────────────────────────────────────────


// ─── GET /api/listings/[id] ───────────────────────────────────────────────────
// Public. Returns a single active listing.

/**
 * @swagger
 * /api/listings/{id}:
 *   get:
 *     tags: [Listings]
 *     summary: Get a listing by ID
 *     description: |
 *       Returns a single listing with seller and category names.
 *       Published listings (active, reserved or sold) are visible publicly; draft and
 *       removed rows are visible only to the owner or an admin.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Listing details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Listing'
 *                 - type: object
 *                   properties:
 *                     sellerName:
 *                       type: string
 *                       example: John Doe
 *                     sellerAvatarUrl:
 *                       type: string
 *                       nullable: true
 *                     sellerReviewCount:
 *                       type: integer
 *                     sellerRatingSum:
 *                       type: integer
 *                     categoryName:
 *                       type: string
 *                       nullable: true
 *                       example: Electronics
 *       400:
 *         description: Invalid listing id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError(
        "Invalid listing id",
        400 );
    }

    const [listing] = await db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
        price: listings.price,
        status: listings.status,
        sellerId: listings.sellerId,
        categoryId: listings.categoryId,
        createdAt: listings.createdAt,
        sellerName: users.name,
        sellerAvatarUrl: users.avatarUrl,
        sellerReviewCount: users.reviewCount,
        sellerRatingSum: users.ratingSum,
        categoryName: categories.name,
      })
      .from(listings)
      .leftJoin(users, eq(users.id, listings.sellerId))
      .leftJoin(categories, eq(categories.id, listings.categoryId))
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) {
      return jsonError(
        "Listing not found",
        404
      );
    }

    // Allow the owner seller or admin to view their own non-active listings
    let isOwnerOrAdmin = false;
    try {
      const payload = authenticate(_request);
      if (payload.role === "admin" || payload.sub === listing.sellerId) {
        isOwnerOrAdmin = true;
      }
    } catch (err) {
      // Only a failed authentication means "anonymous visitor". A missing JWT_SECRET or
      // any other fault is a server problem, and swallowing it here served every caller a
      // logged-out view of a broken deployment.
      if (!(err instanceof AuthError)) throw err;
    }

    // Published listings are readable by anyone; drafts and removed listings only by
    // their owner or an admin. See PUBLIC_LISTING_STATUSES for why `sold` is public.
    if (!isPubliclyVisible(listing.status) && !isOwnerOrAdmin) {
      return jsonError("Listing not found", 404);
    }

    // Summaries, not rows — `storageKey` must not reach the client.
    const images = (await listImagesFor(listing.id)).map(toImageSummary);

    return jsonOk({
      ...listing,
      coverImageId: images[0]?.id ?? null,
      images,
    });
  } catch (err) {
    console.error("[GET /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── PATCH /api/listings/[id] ─────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

/**
 * @swagger
 * /api/listings/{id}:
 *   patch:
 *     tags: [Listings]
 *     summary: Update a listing
 *     description: Updates an existing listing. Only the owner seller or an admin may update. Partial updates supported.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: iPhone 15 Pro Max
 *               description:
 *                 type: string
 *                 example: Updated description
 *               price:
 *                 oneOf:
 *                   - type: number
 *                   - type: string
 *                 example: 1099.99
 *               categoryId:
 *                 type: integer
 *                 nullable: true
 *                 example: 3
 *               status:
 *                 type: string
 *                 enum: [draft, active, sold, removed]
 *                 example: active
 *     responses:
 *       200:
 *         description: Listing updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Listing'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not the owner or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: A live order (pending, confirmed or shipped) is still holding this listing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError("Invalid listing id",
        400
      );
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may update. 403 rather than 404 here on purpose: a
    // listing is a public object, so confirming it exists discloses nothing that
    // GET /api/listings does not already publish.
    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden", 403);
    }

    const parsed = await parseRequest(request, UpdateListingSchema);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { title, description, price, categoryId, status } = parsed.data;

    // A listing an order is counting on is not the seller's to re-status. `reserved` means
    // a buyer is waiting on an answer; `sold` means one already got it and has not been
    // settled. Either way the order is what clears the listing — decline it, cancel it, or
    // let it lapse. Relisting instead would leave two live orders on one object, which the
    // `orders_one_live_per_listing_idx` index refuses and the next buyer would meet as an
    // error. Admins are unrestricted, as everywhere else.
    //
    // `reserved` needs no lookup: only the reservation path sets it, so it always implies a
    // live order. `sold` does need one, because a completed sale stays `sold` forever and
    // relisting after that is legitimate.
    const heldByLiveOrder =
      listing.status === "reserved" ||
      (listing.status === "sold" && (await hasLiveOrder(db, id)));

    if (status !== undefined && !isAdmin(payload) && heldByLiveOrder) {
      return jsonError(
        "An order is still in progress for this listing. Settle that order first.",
        409,
      );
    }

    if (categoryId !== undefined && categoryId !== null) {
      if (!(await isLeafCategory(categoryId))) {
        return jsonError(
          "Listings must be filed under a category with no subcategories",
          400,
        );
      }
    }

    // ── Build update payload (only provided fields) ───────────────────────────
    // The schema guarantees at least one field is present and that every value
    // is already validated and normalised; this only maps it onto the row.
    // embeddingUpdatedAt is stamped with SQL now() rather than a JS Date, so that it
    // shares a clock with updated_at; the inferred insert type does not model that.
    const updates: Partial<
      Omit<typeof listings.$inferInsert, "embeddingUpdatedAt">
    > & { embeddingUpdatedAt?: Date | null | SQL } = {};

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    // `price` is already the canonical decimal string priceField produces; the column
    // is numeric(10,2), which Drizzle types as string, so no conversion is needed.
    if (price !== undefined) updates.price = price;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (status !== undefined) updates.status = status;

    // Re-embed only when the embedded *text* actually changed. Comparing values rather
    // than which fields were sent means a client that PATCHes the whole object on every
    // save does not pay for a new vector on a price edit (AC4).
    let outcome: EmbeddingOutcome | undefined;
    if (needsReembedding(listing, parsed.data)) {
      outcome = await computeListingEmbedding({
        title: title ?? listing.title,
        description: description ?? listing.description,
      });

      if (outcome.status === "embedded") {
        updates.embedding = outcome.embedding;
        updates.embeddingUpdatedAt = sql`now()`;
      } else {
        // The text moved on but the vector could not follow. Clearing it keeps
        // `embedding IS NOT NULL` honest — AI-7 must not rank on a vector describing text
        // that no longer exists — and leaves the row for the backfill.
        updates.embedding = null;
        updates.embeddingUpdatedAt = null;
      }
    }

    const [updated] = await db
      .update(listings)
      .set(updates)
      .where(eq(listings.id, id))
      .returning(listingColumns);

    if (outcome?.status === "failed") {
      console.error(
        `[PATCH /api/listings/[id]] embedding failed for listing ${updated.id}; stored without one`,
        outcome.error,
      );
    }

    return jsonOk(updated);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    console.error("[PATCH /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}

// ─── DELETE /api/listings/[id] ────────────────────────────────────────────────
// Authenticated. Role: owner seller or admin.

/** The listing was deleted between the ownership check and the row lock. */
class ListingGoneMidDelete extends Error {}

/**
 * @swagger
 * /api/listings/{id}:
 *   delete:
 *     tags: [Listings]
 *     summary: Delete a listing
 *     description: |
 *       Only the owner seller or an admin may delete. A listing with no order history is
 *       deleted outright, along with its stored images. A listing any order references is
 *       withdrawn instead: `orders.listing_id` is RESTRICT, so the row cannot be deleted
 *       while an order still points at it. Withdrawing sets `status` to `removed`, which
 *       is outside PUBLIC_LISTING_STATUSES and so leaves browse, search and the public
 *       detail route -- the buyer's order keeps pointing at something real, and its
 *       images are left alone.
 *
 *       The response body's `status` field tells the two outcomes apart: `"deleted"` for
 *       a hard delete, `"removed"` for a withdrawal.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Listing deleted or withdrawn — see `status` in the response body.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Listing deleted successfully
 *                 status:
 *                   type: string
 *                   enum: [deleted, removed]
 *                   description: >
 *                     `deleted` when the row was hard-deleted; `removed` when it was
 *                     withdrawn instead because an order still references it.
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Not the owner or admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Listing not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);
    authorize("seller", "admin")(payload);

    const { id: rawId } = await params;
    const id = parseResourceId(rawId);

    if (!id) {
      return jsonError("Invalid listing id", 400);
    }

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) {
      return jsonError("Listing not found", 404);
    }

    // Only the owner or an admin may delete. 403 rather than 404 here on purpose: a
    // listing is a public object, so confirming it exists discloses nothing that
    // GET /api/listings does not already publish.
    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden", 403);
    }

    // `orders.listing_id` is RESTRICT, and rightly so: an order that pointed at nothing
    // would be a receipt for a purchase the system could no longer describe. So a listing
    // with history is withdrawn rather than deleted.
    //
    // `removed` is outside PUBLIC_LISTING_STATUSES, so this takes the listing out of
    // browse, search and the public detail route -- which is what the seller asked for --
    // while the buyer's order keeps pointing at something real.
    //
    // The check and the write have to share a lock, not just a transaction. Read
    // unlocked, this had the same shape as the upload/reorder race Task 9 closed:
    // `claimListing` (src/db/orders.ts) claims exactly the `active`, order-free listings
    // that reach the branch below with `UPDATE listings SET status = 'reserved' WHERE
    // status = 'active'`, so a purchase committing in the gap between this SELECT and the
    // delete/withdraw write would insert the referencing order *after* this handler had
    // already decided there wasn't one, and `db.delete(listings)` would hit RESTRICT --
    // the exact opaque 500 this task exists to close. Same idiom as
    // listings/[id]/images/route.ts: `SELECT ... FOR UPDATE` on the listing row first, so
    // `claimListing`'s `UPDATE` either commits before this transaction starts or blocks
    // until this one commits.
    const outcome = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, id))
        .for("update")
        .limit(1);

      // Deleted between the authorisation read and this lock. A `return` here would still
      // commit the (otherwise empty) transaction; throwing matches every other early exit
      // from this callback, none of which may depend on happening to precede a write.
      if (!locked) throw new ListingGoneMidDelete();

      const [referencingOrder] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.listingId, id))
        .limit(1);

      if (referencingOrder) {
        await tx.update(listings).set({ status: "removed" }).where(eq(listings.id, id));
        // The images stay. The row still exists and an order still links to it, so
        // removing its objects would leave that order pointing at a listing with no
        // photos.
        return { kind: "removed" as const };
      }

      // Read the image rows *before* the delete: migration 0012's ON DELETE CASCADE
      // takes listing_images (and with it, the only record of the storage keys) down
      // with the listing row. After the cascade nothing can enumerate the orphaned
      // objects.
      const images = await listImagesFor(id, tx);
      await tx.delete(listings).where(eq(listings.id, id));
      return { kind: "deleted" as const, images };
    });

    if (outcome.kind === "removed") {
      return jsonOk({
        message:
          "Listing withdrawn. It is no longer visible to buyers, but it cannot be deleted outright because it has order history.",
        status: "removed",
      });
    }

    // Storage I/O runs only after the transaction has committed: it is slow, it is not
    // transactional, and a failure here must not roll back a delete that already
    // succeeded. Row first, object second, same as
    // DELETE /api/listings/[id]/images/[imageId]: best-effort cleanup that must not fail
    // a request the row-delete already succeeded.
    for (const image of outcome.images) {
      try {
        await getStorageProvider().delete(image.storageKey);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        console.error("[DELETE /api/listings/[id]] object left behind", image.storageKey, err);
      }
    }

    return jsonOk({ message: "Listing deleted successfully", status: "deleted" });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.statusCode);
    }
    if (err instanceof ListingGoneMidDelete) {
      return jsonError("Listing not found", 404);
    }
    console.error("[DELETE /api/listings/[id]]", err);
    return jsonError("Internal server error", 500);
  }
}
