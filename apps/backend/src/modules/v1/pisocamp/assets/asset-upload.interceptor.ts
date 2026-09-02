import {
	BadRequestException,
	CallHandler,
	ExecutionContext,
	Inject,
	Injectable,
	NestInterceptor,
	Optional,
	PayloadTooLargeException,
} from "@nestjs/common"
import { randomBytes } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Request, Response } from "express"
import multer, { diskStorage, MulterError } from "multer"
import { Observable } from "rxjs"

import type { PisoCampAssetRole } from "@repo/contracts/pisocamp-assets"

import {
	AssetFilePolicyError,
	prepareAssetUpload,
	type PreparedAssetUpload,
} from "./asset-file-policy"

const MAX_TRANSPORT_BYTES = 52_428_800
const PREPARED_ASSET_UPLOAD = Symbol("preparedAssetUpload")
export const ASSET_UPLOAD_DIRECTORY_REMOVER = Symbol("assetUploadDirectoryRemover")

type AssetUploadDirectoryRemover = (path: string) => Promise<void>
const removeUploadDirectory: AssetUploadDirectoryRemover = path =>
	rm(path, { recursive: true, force: true })

type AssetUploadRequest = Request & {
	body: Record<string, unknown> & { file?: File }
	[PREPARED_ASSET_UPLOAD]?: PreparedAssetUpload
}

export function getPreparedAssetUpload(request: object): PreparedAssetUpload {
	const prepared = (request as AssetUploadRequest)[PREPARED_ASSET_UPLOAD]
	if (!prepared) throw new BadRequestException("Invalid asset upload")
	return prepared
}

const safeUploadError = (error: unknown): BadRequestException | PayloadTooLargeException => {
	if (
		(error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") ||
		(error instanceof AssetFilePolicyError && error.code === "asset_too_large")
	) {
		return new PayloadTooLargeException("Asset upload exceeds the allowed size")
	}
	return new BadRequestException("Invalid asset upload")
}

@Injectable()
export class AssetUploadInterceptor implements NestInterceptor {
	constructor(
		@Optional()
		@Inject(ASSET_UPLOAD_DIRECTORY_REMOVER)
		private readonly removeDirectory: AssetUploadDirectoryRemover = removeUploadDirectory
	) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const request = context.switchToHttp().getRequest<AssetUploadRequest>()
		const response = context.switchToHttp().getResponse<Response>()
		const requestDirectory = await mkdtemp(join(tmpdir(), "pisocamp-asset-upload-"))
		let cleanupPromise: Promise<void> | undefined
		const beginCleanup = () => {
			if (!cleanupPromise) {
				cleanupPromise = (async () => {
					try {
						await this.removeDirectory(requestDirectory)
					} catch {
						try {
							await this.removeDirectory(requestDirectory)
						} catch {
							throw new Error("asset_upload_cleanup_failed")
						}
					}
				})()
				void cleanupPromise.catch(() => undefined)
			}
			return cleanupPromise
		}
		const ensureCleanup = async () => beginCleanup()
		let aborted = request.destroyed
		const onAborted = () => {
			aborted = true
			void beginCleanup().catch(() => undefined)
		}
		request.once("aborted", onAborted)

		try {
			await chmod(requestDirectory, 0o700)
			const parser = multer({
				storage: diskStorage({
					destination: requestDirectory,
					filename: (_request, _file, callback) => callback(null, randomBytes(32).toString("hex")),
				}),
				limits: {
					fieldNameSize: 101,
					fieldSize: 1025,
					fields: 6,
					files: 1,
					parts: 8,
					fileSize: MAX_TRANSPORT_BYTES + 1,
				},
			}).single("file")

			await new Promise<void>((resolve, reject) => {
				parser(request, response, error => (error ? reject(error) : resolve()))
			})
			if (aborted || !request.file) throw new BadRequestException("Invalid asset upload")
			if (request.file.size > MAX_TRANSPORT_BYTES) {
				throw new PayloadTooLargeException("Asset upload exceeds the allowed size")
			}
			const body = request.body as Record<string, unknown> & { file?: File }
			if (
				Object.entries(body).some(
					([key, value]) =>
						Buffer.byteLength(key, "utf8") > 100 ||
						typeof value !== "string" ||
						Buffer.byteLength(value, "utf8") > 1024
				)
			) {
				throw new BadRequestException("Invalid asset upload")
			}
			const role = body.role
			if (
				role !== "obverse" &&
				role !== "reverse" &&
				role !== "edge" &&
				role !== "texture" &&
				role !== "audio" &&
				role !== "animation"
			) {
				throw new BadRequestException("Invalid asset upload")
			}
			const prepared = await prepareAssetUpload(request.file.path, role as PisoCampAssetRole)
			delete request.file
			body.file = prepared.file
			Object.defineProperty(request, PREPARED_ASSET_UPLOAD, {
				configurable: false,
				enumerable: false,
				value: prepared,
				writable: false,
			})
			await ensureCleanup()
			return next.handle()
		} catch (error) {
			await ensureCleanup()
			if (error instanceof BadRequestException || error instanceof PayloadTooLargeException) {
				throw error
			}
			throw safeUploadError(error)
		} finally {
			request.off("aborted", onAborted)
			delete request.file
			await ensureCleanup()
		}
	}
}
