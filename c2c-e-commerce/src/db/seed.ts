import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

import { users } from "./schema/users";
import { categories } from "./schema/categories";
import { listings } from "./schema/listings";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const SALT_ROUNDS = 12;

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  console.log("🌱 Seeding database...");

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

  // ─── Categories ───────────────────────────────────────────────────────────
  const categoryData = [
    { name: "Electronics", slug: "electronics", description: "Phones, laptops, gadgets and more" },
    { name: "Clothing", slug: "clothing", description: "Men's and women's apparel" },
    { name: "Home & Garden", slug: "home-garden", description: "Furniture, decor and garden tools" },
    { name: "Books", slug: "books", description: "Fiction, non-fiction and textbooks" },
    { name: "Sports", slug: "sports", description: "Sporting goods and outdoor equipment" },
  ];

  const insertedCategories = await db
    .insert(categories)
    .values(categoryData.map((c) => ({ ...c, path: "" })))
    .returning();

  // All seeded categories are roots, so path is just the id — but the id only exists
  // after the insert above, hence the follow-up update rather than a value up front.
  await db.execute(sql`UPDATE categories SET path = id::text WHERE path = ''`);

  console.log(`  ✔ Categories created: ${insertedCategories.map((c) => c.name).join(", ")}`);

  // build a slug → id map for convenience
  const catBySlug = Object.fromEntries(insertedCategories.map((c) => [c.slug, c.id]));

  // ─── Listings (all owned by the seller user) ─────────────────────────────
  const listingData = [
    {
      title: "iPhone 14 Pro — excellent condition",
      description: "Used for 6 months. Comes with original box and charger. No scratches.",
      price: "499.99",
      imageUrl: "https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["electronics"],
    },
    {
      title: "Dell XPS 15 Laptop",
      description: "16 GB RAM, 512 GB SSD, Intel i7. Battery health 92%.",
      price: "879.00",
      imageUrl: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["electronics"],
    },
    {
      title: "Vintage Denim Jacket — Size M",
      description: "Genuine Levi's from the 90s. Great vintage look, minor fading.",
      price: "45.00",
      imageUrl: "https://images.unsplash.com/photo-1551537482-f2075a1d41f2?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["clothing"],
    },
    {
      title: "IKEA KALLAX Shelf Unit",
      description: "White, 4×4, disassembled for easy transport. All hardware included.",
      price: "60.00",
      imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["home-garden"],
    },
    {
      title: "Clean Code by Robert C. Martin",
      description: "Paperback, like new. A must-read for every software developer.",
      price: "15.50",
      imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["books"],
    },
    {
      title: "Wilson Tennis Racket",
      description: "Pro Staff 97. Grip size 3. Lightly used, freshly strung.",
      price: "120.00",
      imageUrl: "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=800&auto=format&fit=crop",
      sellerId: seller.id,
      categoryId: catBySlug["sports"],
    },
  ];

  const insertedListings = await db
    .insert(listings)
    .values(listingData)
    .returning();

  console.log(`  ✔ Listings created: ${insertedListings.length} items`);

  // ─── Done ─────────────────────────────────────────────────────────────────
  await pool.end();
  console.log("🌱 Seeding complete!");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
