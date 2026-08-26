CREATE TABLE "content_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_working_version_id" uuid,
	"current_published_version_id" uuid,
	"created_by" text NOT NULL,
	"last_edited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_item_id_type_unique" UNIQUE("id","content_type"),
	CONSTRAINT "content_item_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link')),
	CONSTRAINT "content_item_status_check" CHECK ("status" in ('draft', 'submitted_for_review', 'approved', 'published', 'unpublished', 'deactivated', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "content_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"parent_version_id" uuid,
	"status" text NOT NULL,
	"content_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text,
	"series_code" text,
	"denomination_code" text,
	"primary_url" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"published_by" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "content_version_item_version_no_unique" UNIQUE("item_id","version_no"),
	CONSTRAINT "content_version_item_id_id_unique" UNIQUE("item_id","id"),
	CONSTRAINT "content_version_number_check" CHECK ("version_no" > 0),
	CONSTRAINT "content_version_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link')),
	CONSTRAINT "content_version_status_check" CHECK ("status" in ('draft', 'submitted_for_review', 'approved', 'published', 'unpublished', 'deactivated', 'archived')),
	CONSTRAINT "content_version_fields_check" CHECK ((
				("content_type" = 'banknote' and "series_code" in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'coin' and "series_code" in ('ngc-coins', 'bsp-coin-series') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'security_feature' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'advisory' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'link' and "series_code" is null and "denomination_code" is null and "primary_url" is not null)
			)),
	CONSTRAINT "content_version_common_text_check" CHECK ("title" = btrim("title") and char_length("title") between 1 and 160 and "title" !~ '<!--|</?[A-Za-z]|<!|<\?' and "summary" = btrim("summary") and char_length("summary") between 1 and 500 and "summary" !~ '<!--|</?[A-Za-z]|<!|<\?' and ("body" is null or ("body" = btrim("body") and char_length("body") between 0 and 10000 and "body" !~ '<!--|</?[A-Za-z]|<!|<\?'))),
	CONSTRAINT "content_version_primary_url_check" CHECK ("primary_url" is null or ("primary_url" = btrim("primary_url") and char_length("primary_url") <= 2048 and "primary_url" ~ '^https://[^[:space:]]+$')),
	CONSTRAINT "content_version_approval_fields_check" CHECK (("approved_by" is null) = ("approved_at" is null)),
	CONSTRAINT "content_version_publication_fields_check" CHECK (("published_by" is null) = ("published_at" is null)),
	CONSTRAINT "content_version_lifecycle_fields_check" CHECK ((
				("status" in ('draft', 'submitted_for_review') and "approved_by" is null and "approved_at" is null and "published_by" is null and "published_at" is null)
				or ("status" = 'approved' and "approved_by" is not null and "approved_at" is not null and "published_by" is null and "published_at" is null)
				or ("status" in ('published', 'unpublished', 'deactivated', 'archived') and "approved_by" is not null and "approved_at" is not null and "published_by" is not null and "published_at" is not null)
			))
);
--> statement-breakpoint
CREATE TABLE "piso_camp_currency_denomination" (
	"series_code" text,
	"code" text,
	"minor_unit_value" integer NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "piso_camp_currency_denomination_pkey" PRIMARY KEY("series_code","code"),
	CONSTRAINT "piso_camp_currency_denomination_series_sort_unique" UNIQUE("series_code","sort_order"),
	CONSTRAINT "piso_camp_currency_denomination_minor_unit_value_check" CHECK ("minor_unit_value" > 0),
	CONSTRAINT "piso_camp_currency_denomination_sort_order_check" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "piso_camp_currency_series" (
	"code" text PRIMARY KEY,
	"name" text NOT NULL,
	"media_kind" text NOT NULL,
	"source_url" text NOT NULL,
	"catalog_version" text NOT NULL,
	CONSTRAINT "piso_camp_currency_series_code_media_kind_unique" UNIQUE("code","media_kind"),
	CONSTRAINT "piso_camp_currency_series_media_kind_check" CHECK ("media_kind" in ('banknote', 'coin')),
	CONSTRAINT "piso_camp_currency_series_source_url_check" CHECK ("source_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "related_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"external_url" text,
	"internal_route" text,
	"target_content_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_link_version_position_unique" UNIQUE("content_version_id","position"),
	CONSTRAINT "related_link_position_check" CHECK ("position" between 0 and 9),
	CONSTRAINT "related_link_kind_check" CHECK ("kind" in ('external', 'internal', 'topic')),
	CONSTRAINT "related_link_label_check" CHECK ("label" = btrim("label") and char_length("label") between 1 and 100 and "label" !~ '<!--|</?[A-Za-z]|<!|<\?'),
	CONSTRAINT "related_link_target_check" CHECK ((
				("kind" = 'external' and "external_url" is not null and "internal_route" is null and "target_content_item_id" is null)
				or ("kind" = 'internal' and "external_url" is null and "internal_route" is not null and "target_content_item_id" is null)
				or ("kind" = 'topic' and "external_url" is null and "internal_route" is null and "target_content_item_id" is not null)
			)),
	CONSTRAINT "related_link_external_url_check" CHECK ("external_url" is null or ("external_url" = btrim("external_url") and char_length("external_url") <= 2048 and "external_url" ~ '^https://[^[:space:]]+$')),
	CONSTRAINT "related_link_internal_route_check" CHECK ("internal_route" is null or (char_length("internal_route") <= 512 and "internal_route" ~ '^/[a-z0-9]+([a-z0-9-]*[a-z0-9])?(/[a-z0-9]+([a-z0-9-]*[a-z0-9])?)*$'))
);
--> statement-breakpoint
CREATE INDEX "content_item_list_idx" ON "content_item" ("status","content_type","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_item_created_by_idx" ON "content_item" ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_version_item_created_idx" ON "content_version" ("item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_version_currency_idx" ON "content_version" ("series_code","denomination_code");--> statement-breakpoint
CREATE INDEX "content_version_created_by_idx" ON "content_version" ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_version_search_idx" ON "content_version" USING gin (to_tsvector('simple', "title" || ' ' || "summary"));--> statement-breakpoint
CREATE INDEX "related_link_topic_target_idx" ON "related_link" ("target_content_item_id");--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_last_edited_by_users_id_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_item_id_content_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "content_item"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_approved_by_users_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_published_by_users_id_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_item_type_fkey" FOREIGN KEY ("item_id","content_type") REFERENCES "content_item"("id","content_type") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_currency_denomination_fkey" FOREIGN KEY ("series_code","denomination_code") REFERENCES "piso_camp_currency_denomination"("series_code","code") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "piso_camp_currency_denomination" ADD CONSTRAINT "piso_camp_currency_denomination_d59pAmyq3tNF_fkey" FOREIGN KEY ("series_code") REFERENCES "piso_camp_currency_series"("code") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "related_link" ADD CONSTRAINT "related_link_content_version_id_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_version"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "related_link" ADD CONSTRAINT "related_link_target_content_item_id_content_item_id_fkey" FOREIGN KEY ("target_content_item_id") REFERENCES "content_item"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_current_working_version_fkey" FOREIGN KEY ("id","current_working_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_current_published_version_fkey" FOREIGN KEY ("id","current_published_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_parent_item_fkey" FOREIGN KEY ("item_id","parent_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION "content_item_type_immutable"() RETURNS trigger AS $$
BEGIN
	IF NEW.content_type IS DISTINCT FROM OLD.content_type THEN
		RAISE EXCEPTION 'immutable content type: content_item.content_type cannot change' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_item_type_immutable_trigger"
	BEFORE UPDATE OF "content_type" ON "content_item"
	FOR EACH ROW EXECUTE FUNCTION "content_item_type_immutable"();--> statement-breakpoint
CREATE FUNCTION "content_version_immutable"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'immutable content_version: UPDATE and DELETE are forbidden' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_version_immutable_trigger"
	BEFORE UPDATE OR DELETE ON "content_version"
	FOR EACH ROW EXECUTE FUNCTION "content_version_immutable"();--> statement-breakpoint
CREATE FUNCTION "related_link_immutable"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'immutable related_link: UPDATE and DELETE are forbidden' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "related_link_immutable_trigger"
	BEFORE UPDATE OR DELETE ON "related_link"
	FOR EACH ROW EXECUTE FUNCTION "related_link_immutable"();--> statement-breakpoint
INSERT INTO "piso_camp_currency_series" ("code", "name", "media_kind", "source_url", "catalog_version") VALUES
	('fpp-banknotes', 'First Philippine Polymer Banknote Series', 'banknote', 'https://www.bsp.gov.ph/SitePages/CoinsAndNotes/PolymerBanknote.aspx', 'BSP-CURRENCY-2026-08-25'),
	('engc-banknotes', 'Enhanced New Generation Currency Banknotes', 'banknote', 'https://www.bsp.gov.ph/Coins%20and%20Notes/Educational%20Campaign/engc%20flyer.pdf', 'BSP-CURRENCY-2026-08-25'),
	('ngc-banknotes', 'New Generation Currency Banknotes', 'banknote', 'https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx', 'BSP-CURRENCY-2026-08-25'),
	('ngc-coins', 'New Generation Currency Coin Series', 'coin', 'https://www.bsp.gov.ph/Media_and_Research/Primers%20Faqs/NGCCoins.pdf', 'BSP-CURRENCY-2026-08-25'),
	('bsp-coin-series', 'BSP Coin Series', 'coin', 'https://www.bsp.gov.ph/SitePages/CoinsAndNotes/BSPCoinSeries.aspx', 'BSP-CURRENCY-2026-08-25')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "piso_camp_currency_denomination" ("series_code", "code", "minor_unit_value", "label", "sort_order") VALUES
	('fpp-banknotes', 'php-50', 5000, 'PHP 50', 0),
	('fpp-banknotes', 'php-100', 10000, 'PHP 100', 1),
	('fpp-banknotes', 'php-500', 50000, 'PHP 500', 2),
	('fpp-banknotes', 'php-1000', 100000, 'PHP 1,000', 3),
	('engc-banknotes', 'php-50', 5000, 'PHP 50', 0),
	('engc-banknotes', 'php-100', 10000, 'PHP 100', 1),
	('engc-banknotes', 'php-200', 20000, 'PHP 200', 2),
	('engc-banknotes', 'php-500', 50000, 'PHP 500', 3),
	('engc-banknotes', 'php-1000', 100000, 'PHP 1,000', 4),
	('ngc-banknotes', 'php-20', 2000, 'PHP 20', 0),
	('ngc-banknotes', 'php-50', 5000, 'PHP 50', 1),
	('ngc-banknotes', 'php-100', 10000, 'PHP 100', 2),
	('ngc-banknotes', 'php-200', 20000, 'PHP 200', 3),
	('ngc-banknotes', 'php-500', 50000, 'PHP 500', 4),
	('ngc-banknotes', 'php-1000', 100000, 'PHP 1,000', 5),
	('ngc-coins', 'sentimo-1', 1, '1 Sentimo', 0),
	('ngc-coins', 'sentimo-5', 5, '5 Sentimo', 1),
	('ngc-coins', 'sentimo-25', 25, '25 Sentimo', 2),
	('ngc-coins', 'php-1', 100, 'PHP 1', 3),
	('ngc-coins', 'php-5', 500, 'PHP 5', 4),
	('ngc-coins', 'php-10', 1000, 'PHP 10', 5),
	('ngc-coins', 'php-20', 2000, 'PHP 20', 6),
	('bsp-coin-series', 'sentimo-1', 1, '1 Sentimo', 0),
	('bsp-coin-series', 'sentimo-5', 5, '5 Sentimo', 1),
	('bsp-coin-series', 'sentimo-10', 10, '10 Sentimo', 2),
	('bsp-coin-series', 'sentimo-25', 25, '25 Sentimo', 3),
	('bsp-coin-series', 'php-1', 100, 'PHP 1', 4),
	('bsp-coin-series', 'php-5', 500, 'PHP 5', 5),
	('bsp-coin-series', 'php-10', 1000, 'PHP 10', 6)
ON CONFLICT DO NOTHING;
