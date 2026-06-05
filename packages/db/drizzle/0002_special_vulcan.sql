CREATE TABLE "physical_objects" (
	"physical_key" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_objects" (
	"owner_branch_id" uuid NOT NULL,
	"path" text NOT NULL,
	"physical_key" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"content_type" text,
	"etag" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"upload_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_objects_owner_branch_id_path_pk" PRIMARY KEY("owner_branch_id","path")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "ancestry" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_owner_branch_id_branches_id_fk" FOREIGN KEY ("owner_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_physical_key_physical_objects_physical_key_fk" FOREIGN KEY ("physical_key") REFERENCES "public"."physical_objects"("physical_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_objects_owner_path_c_idx" ON "storage_objects" USING btree ("owner_branch_id","path" COLLATE "C");--> statement-breakpoint
CREATE INDEX "storage_objects_physical_key_idx" ON "storage_objects" USING btree ("physical_key");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_id_branches_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: existing branches have no recorded parent, so each becomes a self-rooted ancestry
-- (`{self}`). New branches set their ancestry explicitly at insert.
UPDATE "branches" SET "ancestry" = ARRAY["id"] WHERE "ancestry" = ARRAY[]::uuid[];