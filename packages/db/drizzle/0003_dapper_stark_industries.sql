ALTER TABLE "storage_objects" ADD COLUMN "staged_physical_key" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "staged_size" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD COLUMN "staged_content_type" text;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_staged_physical_key_physical_objects_physical_key_fk" FOREIGN KEY ("staged_physical_key") REFERENCES "public"."physical_objects"("physical_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_objects_staged_physical_key_idx" ON "storage_objects" USING btree ("staged_physical_key");