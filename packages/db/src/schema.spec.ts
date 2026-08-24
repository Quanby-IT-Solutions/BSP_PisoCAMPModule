import { getTableColumns, getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import { moduleConfiguration, pisoCampAccountState, schema } from "./schema.js"

describe("F2 database schema", () => {
	it("defines module_configuration with its persisted value and audit columns", () => {
		expect(getTableName(moduleConfiguration)).toBe("module_configuration")
		expect(Object.keys(getTableColumns(moduleConfiguration))).toEqual(
			expect.arrayContaining(["key", "value", "updatedBy", "createdAt", "updatedAt"])
		)
		expect(schema.moduleConfiguration.table).toBe(moduleConfiguration)
	})

	it("defines account state with status and actor fields", () => {
		expect(getTableName(pisoCampAccountState)).toBe("pisocamp_account_state")
		expect(Object.keys(getTableColumns(pisoCampAccountState))).toEqual(
			expect.arrayContaining([
				"accountId",
				"status",
				"reason",
				"updatedBy",
				"createdAt",
				"updatedAt",
			])
		)
		expect(schema.pisoCampAccountState.table).toBe(pisoCampAccountState)
		expect(getTableConfig(pisoCampAccountState).checks.map(check => check.name)).toContain(
			"pisocamp_account_state_status_check"
		)
	})
})
