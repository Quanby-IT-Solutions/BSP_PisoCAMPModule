ALTER TABLE "content_bundle_blob" DROP CONSTRAINT "content_bundle_blob_media_type_check", ADD CONSTRAINT "content_bundle_blob_media_type_check" CHECK ("media_type" in ('application/json', 'application/octet-stream', 'image/png',
				'image/jpeg', 'image/webp', 'model/gltf-binary'));--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" DROP CONSTRAINT "content_bundle_manifest_entry_kind_check", ADD CONSTRAINT "content_bundle_manifest_entry_kind_check" CHECK ("kind" in ('content', 'image', 'model', 'recognition_model'));--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" DROP CONSTRAINT "content_bundle_manifest_entry_kind_media_type_check", ADD CONSTRAINT "content_bundle_manifest_entry_kind_media_type_check" CHECK (("kind" = 'content' and "media_type" = 'application/json')
				or ("kind" = 'image' and "media_type" in ('image/png', 'image/jpeg', 'image/webp'))
				or ("kind" = 'model' and "media_type" = 'model/gltf-binary')
				or ("kind" = 'recognition_model' and "media_type" in ('application/json', 'application/octet-stream')));--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" DROP CONSTRAINT "content_bundle_manifest_entry_media_type_check", ADD CONSTRAINT "content_bundle_manifest_entry_media_type_check" CHECK ("media_type" in ('application/json', 'application/octet-stream', 'image/png',
				'image/jpeg', 'image/webp', 'model/gltf-binary'));