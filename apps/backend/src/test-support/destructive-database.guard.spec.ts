import { assertDisposablePostgres } from "./destructive-database.guard"

const SAFE_URL = "postgresql://tester:secret@localhost:55438/cm1_task4_hardening_test"
const SENTINEL_USER = "credential-sentinel-user"
const SENTINEL_PASSWORD = "credential-sentinel-password"
const QUERY_PARAMETER_ERROR =
	"Destructive PostgreSQL tests do not allow DATABASE_URL query parameters"

describe("assertDisposablePostgres", () => {
	it("fails closed when destructive database tests are not explicitly enabled", () => {
		expect(() =>
			assertDisposablePostgres({ allowDestructive: undefined, databaseUrl: SAFE_URL })
		).toThrow("ALLOW_DESTRUCTIVE_DATABASE_TESTS=true")
	})

	it("rejects a non-loopback database host", () => {
		expect(() =>
			assertDisposablePostgres({
				allowDestructive: "true",
				databaseUrl: "postgresql://tester:secret@database.example.test:5432/cm1_task4_test",
			})
		).toThrow("loopback PostgreSQL host")
	})

	it("rejects a database name without a dedicated test marker", () => {
		expect(() =>
			assertDisposablePostgres({
				allowDestructive: "true",
				databaseUrl: "postgresql://tester:secret@localhost:5432/pisocamp",
			})
		).toThrow("dedicated test database name")
	})

	it.each([
		["remote host", "host=database.example.test"],
		["Unix socket host", "host=%2Fvar%2Frun%2Fpostgresql"],
		["alternate port", "port=6432"],
		["SSL setting", "ssl=no-verify"],
		["SSL mode", "sslmode=no-verify"],
		["SSL certificate path", "sslcert=%2Ftmp%2Fclient.crt"],
		["SSL key path", "sslkey=%2Ftmp%2Fclient.key"],
		["SSL root certificate path", "sslrootcert=%2Ftmp%2Froot.crt"],
	])("rejects the %s query override without leaking credentials", (_name, query) => {
		const databaseUrl = `postgresql://${SENTINEL_USER}:${SENTINEL_PASSWORD}@localhost:55438/cm1_task4_hardening_test?${query}`
		let thrown: unknown

		try {
			assertDisposablePostgres({ allowDestructive: "true", databaseUrl })
		} catch (error) {
			thrown = error
		}

		expect(thrown).toBeInstanceOf(Error)
		const message = (thrown as Error).message
		expect(message).toBe(QUERY_PARAMETER_ERROR)
		expect(message).not.toContain(databaseUrl)
		expect(message).not.toContain(SENTINEL_USER)
		expect(message).not.toContain(SENTINEL_PASSWORD)
	})

	it("accepts an explicitly enabled loopback dedicated test database", () => {
		expect(assertDisposablePostgres({ allowDestructive: "true", databaseUrl: SAFE_URL })).toEqual({
			host: "localhost",
			databaseName: "cm1_task4_hardening_test",
		})
	})
})
