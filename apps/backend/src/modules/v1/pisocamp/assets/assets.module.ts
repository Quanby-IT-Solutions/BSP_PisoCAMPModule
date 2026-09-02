import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { PostgresAssetObjectStore } from "./asset-object-store"
import { AssetUploadInterceptor } from "./asset-upload.interceptor"
import { AssetsController } from "./assets.controller"
import { AssetsService } from "./assets.service"

@Module({
	imports: [RbacModule],
	controllers: [AssetsController],
	providers: [
		AssetsService,
		PostgresAssetObjectStore,
		AssetUploadInterceptor,
		IdempotencyService,
		IdempotencyInterceptor,
	],
})
export class AssetsModule {}
