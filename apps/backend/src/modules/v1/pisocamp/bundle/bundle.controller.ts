import {
	CallHandler,
	Controller,
	ExecutionContext,
	Get,
	Head,
	Headers,
	HttpStatus,
	Injectable,
	NestInterceptor,
	Param,
	Req,
	Res,
	ServiceUnavailableException,
	UseInterceptors,
} from "@nestjs/common"
import { createHash } from "node:crypto"
import { Implement, implement } from "@orpc/nest"
import { ORPCError } from "@orpc/server"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"
import type { Request, Response } from "express"
import { of, type Observable } from "rxjs"

import type { PisoCampBundleEnvelope } from "@repo/contracts"

import { v1 } from "@/config/api-versions.config"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { PostgresBundleObjectStore } from "./bundle-object-store"
import { BundleRepository } from "./bundle-repository"

const MANIFEST_CACHE_CONTROL = "no-cache"
const RESOURCE_CACHE_CONTROL = "public, max-age=31536000, immutable"
const DIGEST_PATTERN = /^[a-f0-9]{64}$/
const PREPARED_MANIFEST = Symbol("prepared-bundle-manifest")

interface PreparedManifest {
	envelope: PisoCampBundleEnvelope
	etag: string
}

type ManifestRequest = Request & { [PREPARED_MANIFEST]?: PreparedManifest }

function serializeEnvelope(envelope: PisoCampBundleEnvelope): string {
	return JSON.stringify({
		schemaVersion: envelope.schemaVersion,
		algorithm: envelope.algorithm,
		keyId: envelope.keyId,
		payload: envelope.payload,
		signature: envelope.signature,
	})
}

function manifestEtag(envelope: PisoCampBundleEnvelope): string {
	return `"${createHash("sha256").update(serializeEnvelope(envelope)).digest("hex")}"`
}

export function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
	if (header === undefined) return false
	if (header.trim() === "*") return true

	const expected = /^"([\x21\x23-\x7e\x80-\xff]*)"$/.exec(etag)?.[1]
	if (expected === undefined) return false

	let cursor = 0
	let matched = false
	let parsedAny = false
	while (cursor < header.length) {
		while (header[cursor] === " " || header[cursor] === "\t") cursor += 1
		if (header.startsWith("W/", cursor)) cursor += 2
		if (header[cursor] !== '"') return false
		cursor += 1
		const opaqueStart = cursor
		while (cursor < header.length && header[cursor] !== '"') {
			const code = header.charCodeAt(cursor)
			if (!(code === 0x21 || (code >= 0x23 && code <= 0x7e) || code >= 0x80)) return false
			cursor += 1
		}
		if (header[cursor] !== '"') return false
		matched ||= header.slice(opaqueStart, cursor) === expected
		parsedAny = true
		cursor += 1
		while (header[cursor] === " " || header[cursor] === "\t") cursor += 1
		if (cursor === header.length) return parsedAny && matched
		if (header[cursor] !== ",") return false
		cursor += 1
		if (cursor === header.length) return false
	}

	return false
}

export type ParsedByteRange = { start: number; end: number } | null | "unsatisfiable"

export function parseSingleByteRange(
	header: string | undefined,
	fullLength: number
): ParsedByteRange {
	if (header === undefined) return null
	if (fullLength < 1 || header.includes(",")) return "unsatisfiable"
	const match = /^bytes=(\d*)-(\d*)$/.exec(header)
	if (!match) return "unsatisfiable"

	const startText = match[1] ?? ""
	const endText = match[2] ?? ""
	if (startText === "" && endText === "") return "unsatisfiable"

	if (startText === "") {
		const suffix = Number(endText)
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
		return { start: Math.max(0, fullLength - suffix), end: fullLength - 1 }
	}

	const start = Number(startText)
	if (!Number.isSafeInteger(start) || start >= fullLength) return "unsatisfiable"
	if (endText === "") return { start, end: fullLength - 1 }

	const requestedEnd = Number(endText)
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return "unsatisfiable"
	return { start, end: Math.min(requestedEnd, fullLength - 1) }
}

@Injectable()
export class BundleManifestHttpInterceptor implements NestInterceptor {
	constructor(private readonly repository: BundleRepository) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const request = context.switchToHttp().getRequest<ManifestRequest>()
		const response = context.switchToHttp().getResponse<Response>()
		let envelope: PisoCampBundleEnvelope | null
		try {
			envelope = await this.repository.readCurrentReadyEnvelope()
		} catch {
			throw new ServiceUnavailableException("Bundle manifest is temporarily unavailable")
		}
		if (!envelope) {
			throw new ServiceUnavailableException("Bundle manifest is temporarily unavailable")
		}

		const etag = manifestEtag(envelope)
		response.setHeader("Cache-Control", MANIFEST_CACHE_CONTROL)
		response.setHeader("ETag", etag)
		if (ifNoneMatchMatches(request.headers["if-none-match"], etag)) {
			response.status(HttpStatus.NOT_MODIFIED).end()
			return of(undefined)
		}

		request[PREPARED_MANIFEST] = { envelope, etag }
		return next.handle()
	}
}

@Controller()
export class BundleController {
	constructor(private readonly repository: BundleRepository) {}

	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.pisocamp.bundle.manifest.get)
	@UseInterceptors(BundleManifestHttpInterceptor)
	async getManifest(@Req() request?: ManifestRequest, @Res() _response?: Response) {
		return implement(v1.pisocamp.bundle.manifest.get).handler(async () => {
			if (!request) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "Bundle manifest is temporarily unavailable",
				})
			}
			if (request[PREPARED_MANIFEST]) return request[PREPARED_MANIFEST].envelope

			try {
				const envelope = await this.repository.readCurrentReadyEnvelope()
				if (envelope) return envelope
			} catch {
				// Fall through to one stable public error below.
			}
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				message: "Bundle manifest is temporarily unavailable",
			})
		})
	}
}

@Controller({ path: "pisocamp/bundle/resources", version: "1" })
export class BundleResourceController {
	constructor(private readonly objectStore: PostgresBundleObjectStore) {}

	@AllowAnonymous()
	@Head(":sha256")
	async headResource(@Param("sha256") sha256: string, @Res() response: Response): Promise<void> {
		await this.respondWithResource(sha256, undefined, response, false)
	}

	@AllowAnonymous()
	@Get(":sha256")
	async getResource(
		@Param("sha256") sha256: string,
		@Headers("range") requestRange: string | undefined,
		@Res() response: Response
	): Promise<void> {
		await this.respondWithResource(sha256, requestRange, response, true)
	}

	private async respondWithResource(
		sha256: string,
		requestRange: string | undefined,
		response: Response,
		includeBody: boolean
	): Promise<void> {
		if (!DIGEST_PATTERN.test(sha256)) {
			response.status(HttpStatus.NOT_FOUND).end()
			return
		}

		let resource: Awaited<ReturnType<PostgresBundleObjectStore["readPublicByDigest"]>>
		try {
			resource = await this.objectStore.readPublicByDigest(sha256)
		} catch {
			throw new ServiceUnavailableException("Bundle resource is temporarily unavailable")
		}
		if (!resource) {
			response.status(HttpStatus.NOT_FOUND).end()
			return
		}

		const parsedRange = parseSingleByteRange(requestRange, resource.byteLength)
		response.setHeader("Accept-Ranges", "bytes")
		response.setHeader("Cache-Control", RESOURCE_CACHE_CONTROL)
		response.setHeader("ETag", `"${sha256}"`)
		response.setHeader("X-Content-Type-Options", "nosniff")
		response.setHeader("Content-Type", resource.mediaType)

		if (parsedRange === "unsatisfiable") {
			response.setHeader("Content-Range", `bytes */${resource.byteLength}`)
			response.setHeader("Content-Length", "0")
			response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).end()
			return
		}

		if (parsedRange === null) {
			response.setHeader("Content-Length", resource.byteLength)
			response.status(HttpStatus.OK)
			if (includeBody) response.send(resource.bytes)
			else response.end()
			return
		}

		const body = resource.bytes.subarray(parsedRange.start, parsedRange.end + 1)
		response.setHeader("Content-Encoding", "identity")
		response.setHeader(
			"Content-Range",
			`bytes ${parsedRange.start}-${parsedRange.end}/${resource.byteLength}`
		)
		response.setHeader("Content-Length", body.byteLength)
		response.status(HttpStatus.PARTIAL_CONTENT).send(body)
	}
}
