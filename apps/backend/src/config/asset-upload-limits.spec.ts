import { readFile } from "node:fs/promises"
import { join } from "node:path"

const uploadLocation = "location = /api/v1/admin/pisocamp/assets"
const apiLocation = "location /api/"
const proxyHeaders = [
	"proxy_set_header Host $host;",
	"proxy_set_header X-Real-IP $remote_addr;",
	"proxy_set_header X-Forwarded-For $remote_addr;",
	"proxy_set_header X-Forwarded-Proto $scheme;",
]

const nginxFiles = ["nginx.conf", "nginx.dev.conf"] as const

function extractLocation(config: string, location: string) {
	const start = config.indexOf(location)
	if (start < 0) return ""
	const open = config.indexOf("{", start)
	if (open < 0) return ""
	let depth = 0
	for (let index = open; index < config.length; index += 1) {
		if (config[index] === "{") depth += 1
		if (config[index] === "}") depth -= 1
		if (depth === 0) return config.slice(start, index + 1)
	}
	return ""
}

function extractEnclosingServer(config: string, nestedMarker: string) {
	const nestedIndex = config.indexOf(nestedMarker)
	if (nestedIndex < 0) return ""
	const candidates = [...config.matchAll(/\bserver\s*\{/g)]
		.map(match => match.index)
		.filter((index): index is number => index !== undefined && index < nestedIndex)
		.reverse()
	for (const start of candidates) {
		const block = extractLocation(config.slice(start), "server")
		if (block && start + block.length > nestedIndex) return block
	}
	return ""
}

function directChildText(block: string) {
	const open = block.indexOf("{")
	let depth = 1
	let direct = ""
	for (let index = open + 1; index < block.length && depth > 0; index += 1) {
		const character = block[index]
		if (character === "{") {
			depth += 1
			continue
		}
		if (character === "}") {
			depth -= 1
			continue
		}
		if (depth === 1) direct += character
	}
	return direct
}

describe.each(nginxFiles)("asset upload proxy scope in %s", file => {
	let config: string

	beforeAll(async () => {
		config = await readFile(join(process.cwd(), "..", "..", "nginx", file), "utf8")
	})

	it("defines one exact upload route before the generic API proxy", () => {
		expect(config.split(uploadLocation)).toHaveLength(2)
		expect(config.indexOf(uploadLocation)).toBeLessThan(config.indexOf(apiLocation))
	})

	it("scopes the 51 MiB envelope to the exact upload route", () => {
		const exact = extractLocation(config, uploadLocation)
		const server = extractEnclosingServer(config, uploadLocation)
		expect(exact).toContain("client_max_body_size 51m;")
		expect(config.split("client_max_body_size 51m;")).toHaveLength(2)
		expect(config.split("client_max_body_size 1m;")).toHaveLength(2)
		expect(directChildText(server)).toMatch(/^\s*client_max_body_size\s+1m;\s*$/m)
		expect(extractLocation(config, apiLocation)).not.toContain("client_max_body_size 51m;")
	})

	it("preserves the generic API proxy's overwrite-form forwarding headers", () => {
		const exact = extractLocation(config, uploadLocation)
		const generic = extractLocation(config, apiLocation)
		const exactHeaders = exact.match(/proxy_set_header\s+[^;]+;/g) ?? []
		const genericHeaders = generic.match(/proxy_set_header\s+[^;]+;/g) ?? []
		for (const header of proxyHeaders) {
			expect(exact).toContain(header)
			expect(generic).toContain(header)
		}
		expect(exactHeaders).toEqual(genericHeaders)
		expect(exact).not.toContain("$proxy_add_x_forwarded_for")
	})
})
