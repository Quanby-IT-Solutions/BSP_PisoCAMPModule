import { Module } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { env } from "@/config/env.config"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentModule } from "../content/content.module"
import { BundleBuilder, type BundleBuilderConfig } from "./bundle-builder"
import { PostgresBundleObjectStore } from "./bundle-object-store"
import { BundleRepository } from "./bundle-repository"
import { createEd25519BundleSigner, type BundleSigner } from "./bundle-signer"
import { BundleWorker } from "./bundle-worker"
import {
	BundleController,
	BundleManifestHttpInterceptor,
	BundleResourceController,
} from "./bundle.controller"

const BUNDLE_SIGNER = Symbol("PISOCAMP_BUNDLE_SIGNER")
const BUNDLE_BUILDER_CONFIG = Symbol("PISOCAMP_BUNDLE_BUILDER_CONFIG")

@Module({
	imports: [ContentModule],
	controllers: [BundleController, BundleResourceController],
	providers: [
		BundleRepository,
		PostgresBundleObjectStore,
		BundleManifestHttpInterceptor,
		{
			provide: BUNDLE_SIGNER,
			useFactory: (): BundleSigner | null =>
				createEd25519BundleSigner({
					enabled: env.PISOCAMP_BUNDLE_WORKER_ENABLED,
					keyId: env.PISOCAMP_BUNDLE_SIGNING_KEY_ID,
					privateKeyBase64: env.PISOCAMP_BUNDLE_SIGNING_PRIVATE_KEY_BASE64,
				}),
		},
		{
			provide: BUNDLE_BUILDER_CONFIG,
			useFactory: (): BundleBuilderConfig => ({
				leaseSeconds: env.PISOCAMP_BUNDLE_LEASE_SECONDS,
				batchSize: env.PISOCAMP_BUNDLE_BATCH_SIZE,
				owner: `${hostname()}:${process.pid}:${randomUUID()}`,
			}),
		},
		{
			provide: BundleBuilder,
			inject: [
				BundleRepository,
				PostgresBundleObjectStore,
				BUNDLE_SIGNER,
				ContentWorkflowService,
				BUNDLE_BUILDER_CONFIG,
			],
			useFactory: (
				repository: BundleRepository,
				objectStore: PostgresBundleObjectStore,
				signer: BundleSigner | null,
				workflow: ContentWorkflowService,
				config: BundleBuilderConfig
			) => new BundleBuilder(repository, objectStore, signer, workflow, config),
		},
		{
			provide: BundleWorker,
			inject: [BundleBuilder],
			useFactory: (builder: BundleBuilder) =>
				new BundleWorker(builder, env.PISOCAMP_BUNDLE_WORKER_ENABLED),
		},
	],
	exports: [BundleBuilder, BundleWorker, PostgresBundleObjectStore],
})
export class BundleModule {}
