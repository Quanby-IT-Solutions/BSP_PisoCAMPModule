import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { env } from "@/config/env.config"

import { PostgresAssetObjectStore } from "../assets/asset-object-store"
import { PreviewResourceController } from "./preview-resource.controller"
import { derivePreviewTokenKey } from "./preview-token"
import { PreviewController } from "./preview.controller"
import { PREVIEW_TOKEN_CONFIG, PreviewService, type PreviewTokenConfig } from "./preview.service"

@Module({
	imports: [RbacModule],
	controllers: [PreviewController, PreviewResourceController],
	providers: [
		PreviewService,
		PostgresAssetObjectStore,
		{
			provide: PREVIEW_TOKEN_CONFIG,
			useFactory: (): PreviewTokenConfig => ({
				key: derivePreviewTokenKey({
					previewSecret: env.PISOCAMP_PREVIEW_TOKEN_SECRET,
					authSecret: env.BETTER_AUTH_SECRET,
				}),
				ttlSeconds: env.PISOCAMP_PREVIEW_TOKEN_TTL_SECONDS,
			}),
		},
	],
	exports: [PreviewService],
})
export class PreviewModule {}
