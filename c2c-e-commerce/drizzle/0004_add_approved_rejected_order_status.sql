ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'approved';--> statement-breakpoint
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'rejected';
