CREATE TABLE "module_configuration" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pisocamp_account_state" (
	"account_id" text PRIMARY KEY,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pisocamp_account_state_status_check" CHECK ("status" in ('active', 'deactivated'))
);
--> statement-breakpoint
ALTER TABLE "module_configuration" ADD CONSTRAINT "module_configuration_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pisocamp_account_state" ADD CONSTRAINT "pisocamp_account_state_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pisocamp_account_state" ADD CONSTRAINT "pisocamp_account_state_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO "roles" ("name", "description") VALUES
	('Guest User', 'Uses Piso CAMP without registration'),
	('Registered End User', 'Registered Piso CAMP participant'),
	('System Administrator', 'Manages accounts, roles, configuration, audit, and integrations'),
	('Content Administrator', 'Creates and maintains content and assets'),
	('Content Approver', 'Approves, publishes, restores, and audits content'),
	('Reports & Analytics User', 'Views dashboards and generates non-PII reports'),
	('Admin', 'Protected legacy administrator role with explicit legacy permissions'),
	('Manager', 'Can manage posts and read users'),
	('User', 'Standard user with read access to posts')
ON CONFLICT ("name") DO UPDATE SET "description" = EXCLUDED."description", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "permissions" ("name", "description") VALUES
	('content.items.edit', 'Permission: content.items.edit'),
	('content.assets.upload', 'Permission: content.assets.upload'),
	('content.items.submit', 'Permission: content.items.submit'),
	('content.items.approve', 'Permission: content.items.approve'),
	('content.items.publish', 'Permission: content.items.publish'),
	('content.items.restore', 'Permission: content.items.restore'),
	('content.items.preview', 'Permission: content.items.preview'),
	('content.audit.view', 'Permission: content.audit.view'),
	('surveys.triggers.configure', 'Permission: surveys.triggers.configure'),
	('reports.dashboards.view', 'Permission: reports.dashboards.view'),
	('reports.reports.generate', 'Permission: reports.reports.generate'),
	('reports.reports.export', 'Permission: reports.reports.export'),
	('reports.pii.view', 'Permission: reports.pii.view'),
	('admin.accounts.manage', 'Permission: admin.accounts.manage'),
	('admin.roles.assign', 'Permission: admin.roles.assign'),
	('admin.config.manage', 'Permission: admin.config.manage'),
	('admin.audit.view', 'Permission: admin.audit.view'),
	('admin.notifications.send', 'Permission: admin.notifications.send'),
	('admin.integrations.manage', 'Permission: admin.integrations.manage'),
	('posts:read', 'Permission: posts:read'),
	('posts:create', 'Permission: posts:create'),
	('posts:edit', 'Permission: posts:edit'),
	('posts:delete', 'Permission: posts:delete'),
	('posts:*', 'Permission: posts:*'),
	('users:read', 'Permission: users:read'),
	('users:manage', 'Permission: users:manage'),
	('users:read-directory', 'Permission: users:read-directory')
ON CONFLICT ("name") DO UPDATE SET "description" = EXCLUDED."description", "updated_at" = now();
--> statement-breakpoint
WITH grants("role_name", "permission_name") AS (
	VALUES
		('System Administrator', 'admin.accounts.manage'),
		('System Administrator', 'admin.roles.assign'),
		('System Administrator', 'admin.config.manage'),
		('System Administrator', 'admin.audit.view'),
		('System Administrator', 'admin.notifications.send'),
		('System Administrator', 'admin.integrations.manage'),
		('Content Administrator', 'content.items.edit'),
		('Content Administrator', 'content.assets.upload'),
		('Content Administrator', 'content.items.submit'),
		('Content Administrator', 'content.items.preview'),
		('Content Approver', 'content.items.approve'),
		('Content Approver', 'content.items.publish'),
		('Content Approver', 'content.items.restore'),
		('Content Approver', 'content.items.preview'),
		('Content Approver', 'content.audit.view'),
		('Content Approver', 'surveys.triggers.configure'),
		('Reports & Analytics User', 'reports.dashboards.view'),
		('Reports & Analytics User', 'reports.reports.generate'),
		('Reports & Analytics User', 'reports.reports.export'),
		('Admin', 'posts:read'),
		('Admin', 'posts:create'),
		('Admin', 'posts:edit'),
		('Admin', 'posts:delete'),
		('Admin', 'posts:*'),
		('Admin', 'users:read'),
		('Admin', 'users:manage'),
		('Admin', 'users:read-directory'),
		('Manager', 'posts:*'),
		('Manager', 'users:read'),
		('User', 'posts:read')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM grants g
JOIN "roles" r ON r."name" = g."role_name"
JOIN "permissions" p ON p."name" = g."permission_name"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT ur."user_id", system_role."id"
FROM "user_roles" ur
JOIN "roles" legacy_role ON legacy_role."id" = ur."role_id" AND legacy_role."name" = 'Admin'
CROSS JOIN "roles" system_role
WHERE system_role."name" = 'System Administrator'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "module_configuration" ("key", "value")
VALUES ('session_inactivity_minutes', '30'::jsonb)
ON CONFLICT ("key") DO NOTHING;
