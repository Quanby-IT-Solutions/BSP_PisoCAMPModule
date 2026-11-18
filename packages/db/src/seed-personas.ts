import "dotenv/config"

import { randomBytes, scryptSync } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { accounts, roles, schema, userRoles, users } from "./schema.js"
import { isLocalDatabaseUrl, SeedRefusedError } from "./seed-guard.js"

/**
 * One signed-in test account per Annex H role.
 *
 * `seed.ts` provisions the fixtures the app needs to boot. This provisions the
 * people needed to *exercise* it: every permission-gated screen needs somebody
 * who can open it and somebody who cannot, and hand-assigning roles through the
 * admin console every time a developer resets their database is how "just use
 * the admin account" becomes the only path anyone ever tests.
 *
 * Idempotent: re-running updates the password and re-asserts role membership
 * rather than duplicating accounts.
 *
 * Local databases only, and the password must be supplied. These are
 * known-credential accounts with real permissions behind them — the guards are
 * the same reasoning as `seed-guard.ts`, which exists because a seeder that
 * mints a known Admin against whatever `DATABASE_URL` happens to be set is one
 * environment variable away from doing it in production.
 */

/** Test domain: `.test` is reserved by RFC 6761 and can never be routable. */
const DOMAIN = "pisocamp.test"

interface Persona {
	readonly key: string
	readonly name: string
	readonly role: string
	readonly purpose: string
}

const PERSONAS: readonly Persona[] = [
	{
		key: "sysadmin",
		name: "Sys Admin",
		role: "System Administrator",
		purpose: "Module configuration, accounts, role assignment, audit log, push",
	},
	{
		key: "content",
		name: "Content Editor",
		role: "Content Administrator",
		purpose: "Draft and submit content, upload assets, preview",
	},
	{
		key: "approver",
		name: "Content Approver",
		role: "Content Approver",
		purpose: "Approve, publish, restore, content audit, survey triggers",
	},
	{
		key: "reports",
		name: "Reports Analyst",
		role: "Reports & Analytics User",
		purpose: "Dashboards, report generation and export",
	},
	{
		key: "member",
		name: "Registered Member",
		role: "Registered End User",
		purpose: "A signed-in member with no admin permissions at all",
	},
]

function hashPassword(password: string): string {
	// Matches seed.ts exactly. Better Auth reads `salt:key`, so a different
	// shape here would store an account that can never sign in.
	const saltHex = randomBytes(16).toString("hex")
	const key = scryptSync(password.normalize("NFKC"), saltHex, 64, {
		N: 16384,
		r: 16,
		p: 1,
		maxmem: 128 * 16384 * 16 * 2,
	})
	return `${saltHex}:${key.toString("hex")}`
}

async function main(): Promise<void> {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) {
		throw new SeedRefusedError("Persona seeding requires DATABASE_URL.")
	}
	if (!isLocalDatabaseUrl(connectionString)) {
		throw new SeedRefusedError(
			"Persona seeding refuses a non-local database. These are known-credential " +
				"accounts carrying real permissions."
		)
	}

	const password = process.env.SEED_PERSONA_PASSWORD
	if (!password || password.length < 12) {
		throw new SeedRefusedError(
			"Set SEED_PERSONA_PASSWORD to at least 12 characters. It is deliberately " +
				"not defaulted: a hard-coded password in a seeder is the thing that ends " +
				"up shared, committed, and eventually reused somewhere that matters."
		)
	}

	const pool = new Pool({ connectionString })
	const db = drizzle({ client: pool, schema })

	try {
		const wanted = PERSONAS.map(p => p.role)
		const roleRows = await db
			.select({ id: roles.id, name: roles.name })
			.from(roles)
			.where(inArray(roles.name, wanted))
		const roleIdByName = new Map(roleRows.map(r => [r.name, r.id]))

		const missing = wanted.filter(r => !roleIdByName.has(r))
		if (missing.length > 0) {
			throw new SeedRefusedError(
				`Roles are not seeded yet: ${missing.join(", ")}. Run the main seeder first.`
			)
		}

		const now = new Date()
		for (const persona of PERSONAS) {
			const id = `persona-${persona.key}`
			const email = `${persona.key}@${DOMAIN}`

			await db
				.insert(users)
				.values({
					id,
					name: persona.name,
					email,
					// Pre-verified: the module refuses sign-in until an address is
					// confirmed, and there is no mailbox behind a `.test` domain.
					emailVerified: true,
					image: null,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: users.id,
					set: { name: persona.name, email, emailVerified: true, updatedAt: now },
				})

			const hashed = hashPassword(password)
			await db
				.delete(accounts)
				.where(and(eq(accounts.providerId, "credential"), eq(accounts.accountId, id)))
			await db.insert(accounts).values({
				providerId: "credential",
				accountId: id,
				userId: id,
				password: hashed,
				createdAt: now,
				updatedAt: now,
			})

			// Exactly one role each. A persona that accumulates roles across runs
			// stops being able to prove that a permission gate actually denies.
			await db.delete(userRoles).where(eq(userRoles.userId, id))
			await db
				.insert(userRoles)
				.values({ userId: id, roleId: roleIdByName.get(persona.role)! })
				.onConflictDoNothing()
		}

		console.log(`Seeded ${PERSONAS.length} role personas on @${DOMAIN}:`)
		for (const p of PERSONAS) {
			console.log(`  ${p.key}@${DOMAIN}  →  ${p.role}`)
			console.log(`      ${p.purpose}`)
		}
		console.log("\nPassword: the value of SEED_PERSONA_PASSWORD (not printed).")
	} finally {
		await pool.end()
	}
}

main().catch((error: unknown) => {
	if (error instanceof SeedRefusedError) {
		console.error(`Persona seeding refused: ${error.message}`)
		process.exit(1)
	}
	console.error(error)
	process.exit(1)
})
