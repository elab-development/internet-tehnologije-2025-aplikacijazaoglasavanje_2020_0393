import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import sharp from "sharp";

import { users } from "./schema/users";
import { categories } from "./schema/categories";
import { listings } from "./schema/listings";
import { listingImages } from "./schema";
import { getStorageProvider } from "@/lib/storage";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const SALT_ROUNDS = 12;

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  console.log("🌱 Seeding database...");

  // Resolved before the truncate on purpose: a misconfigured STORAGE_DIR (the local
  // driver's env var is required, per src/lib/storage.ts) must fail cleanly here, not
  // after the tables below are already gone.
  const storage = getStorageProvider();

  // ─── Clear existing data (order matters due to FK constraints) ────────────
  await db.execute(sql`TRUNCATE listings, categories, users RESTART IDENTITY CASCADE`);

  // ─── Users (one per role) ─────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("password123", SALT_ROUNDS);

  const [buyer] = await db
    .insert(users)
    .values({
      email: "buyer@example.com",
      passwordHash,
      name: "Alice Buyer",
      phoneNumber: "+381601234567",
      role: "buyer",
    })
    .returning();

  const [seller] = await db
    .insert(users)
    .values({
      email: "seller@example.com",
      passwordHash,
      name: "Bob Seller",
      phoneNumber: "+381609876543",
      role: "seller",
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@example.com",
      passwordHash,
      name: "Charlie Admin",
      phoneNumber: "+381600000000",
      role: "admin",
    })
    .returning();

  console.log(`  ✔ Users created: ${buyer.name}, ${seller.name}, ${admin.name}`);

  // ─── Categories (two levels — listings hang off leaves only) ──────────────
  const rootData = [
    { name: "Electronics", slug: "electronics", description: "Phones, laptops, gadgets and more" },
    { name: "Clothing", slug: "clothing", description: "Men's and women's apparel" },
    { name: "Home & Garden", slug: "home-garden", description: "Furniture, decor and garden tools" },
    { name: "Books", slug: "books", description: "Fiction, non-fiction and textbooks" },
    { name: "Sports", slug: "sports", description: "Sporting goods and outdoor equipment" },
  ];

  const insertedRoots = await db
    .insert(categories)
    .values(rootData.map((c, i) => ({ ...c, path: "", depth: 0, sortOrder: i })))
    .returning();

  // The path is the row's own id for a root, which is only knowable after the insert.
  for (const root of insertedRoots) {
    await db
      .update(categories)
      .set({ path: String(root.id) })
      .where(eq(categories.id, root.id));
  }

  const rootBySlug = Object.fromEntries(insertedRoots.map((c) => [c.slug, c]));

  const childData: { name: string; slug: string; parentSlug: string }[] = [
    { name: "Smartphones", slug: "smartphones", parentSlug: "electronics" },
    { name: "Laptops", slug: "laptops", parentSlug: "electronics" },
    { name: "Men's clothing", slug: "mens-clothing", parentSlug: "clothing" },
    { name: "Women's clothing", slug: "womens-clothing", parentSlug: "clothing" },
    { name: "Furniture", slug: "furniture", parentSlug: "home-garden" },
    { name: "Garden tools", slug: "garden-tools", parentSlug: "home-garden" },
    { name: "Fiction", slug: "fiction", parentSlug: "books" },
    { name: "Non-fiction", slug: "non-fiction", parentSlug: "books" },
    { name: "Outdoor", slug: "outdoor", parentSlug: "sports" },
    { name: "Fitness", slug: "fitness", parentSlug: "sports" },
  ];

  const catBySlug: Record<string, number> = {};

  for (const [index, child] of childData.entries()) {
    const parent = rootBySlug[child.parentSlug];

    const [inserted] = await db
      .insert(categories)
      .values({
        name: child.name,
        slug: child.slug,
        description: null,
        parentId: parent.id,
        path: "",
        depth: 1,
        sortOrder: index,
      })
      .returning();

    await db
      .update(categories)
      .set({ path: `${parent.id}.${inserted.id}` })
      .where(eq(categories.id, inserted.id));

    catBySlug[child.slug] = inserted.id;
  }

  console.log(
    `  ✔ Categories created: ${insertedRoots.length} roots, ${childData.length} subcategories`,
  );

  // ─── Listings (all owned by the seller user) ─────────────────────────────
  const listingData = [
    {
      title: "iPhone 14 Pro — excellent condition",
      description: "Used for 6 months. Comes with original box and charger. No scratches.",
      price: "499.99",
      sellerId: seller.id,
      categoryId: catBySlug["smartphones"],
    },
    {
      title: "Dell XPS 15 Laptop",
      description: "16 GB RAM, 512 GB SSD, Intel i7. Battery health 92%.",
      price: "879.00",
      sellerId: seller.id,
      categoryId: catBySlug["laptops"],
    },
    {
      title: "Vintage Denim Jacket — Size M",
      description: "Genuine Levi's from the 90s. Great vintage look, minor fading.",
      price: "45.00",
      sellerId: seller.id,
      categoryId: catBySlug["mens-clothing"],
    },
    {
      title: "IKEA KALLAX Shelf Unit",
      description: "White, 4×4, disassembled for easy transport. All hardware included.",
      price: "60.00",
      sellerId: seller.id,
      categoryId: catBySlug["furniture"],
    },
    {
      title: "Clean Code by Robert C. Martin",
      description: "Paperback, like new. A must-read for every software developer.",
      price: "15.50",
      sellerId: seller.id,
      categoryId: catBySlug["non-fiction"],
    },
    {
      title: "Wilson Tennis Racket",
      description: "Pro Staff 97. Grip size 3. Lightly used, freshly strung.",
      price: "120.00",
      sellerId: seller.id,
      categoryId: catBySlug["outdoor"],
    },
  ];

  const insertedListings = await db
    .insert(listings)
    .values(listingData)
    .returning();

  console.log(`  ✔ Listings created: ${insertedListings.length} items`);

  // ─── Photos ───────────────────────────────────────────────────────────────
  // Seeded photos go through the same StorageProvider as a real upload, so seeded data
  // and uploaded data take exactly one code path (D9).
  const seedImages: Record<string, string> = {
    "iPhone 14 Pro — excellent condition": "iphone.jpg",
    "Dell XPS 15 Laptop": "laptop.jpg",
    "Vintage Denim Jacket — Size M": "jacket.jpg",
    "IKEA KALLAX Shelf Unit": "shelf.jpg",
    "Clean Code by Robert C. Martin": "book.jpg",
    "Wilson Tennis Racket": "racket.jpg",
  };

  for (const listing of insertedListings) {
    const filename = seedImages[listing.title];
    if (!filename) continue;

    const bytes = await readFile(path.resolve(__dirname, "seed-assets", filename));
    const webp = await sharp(bytes).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const stored = await storage.put(webp.data, {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });

    await db.insert(listingImages).values({
      listingId: listing.id,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width: webp.info.width,
      height: webp.info.height,
      sortOrder: 0,
    });
  }

  console.log(`  ✔ Listing photos stored: ${insertedListings.length}`);

  // ─── Done ─────────────────────────────────────────────────────────────────
  await pool.end();
  console.log("🌱 Seeding complete!");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
