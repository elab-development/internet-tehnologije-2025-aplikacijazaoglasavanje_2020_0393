ALTER TABLE "listings" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "rating_range" CHECK ("reviews"."rating" >= 1 AND "reviews"."rating" <= 5);