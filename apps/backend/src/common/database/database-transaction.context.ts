import { AsyncLocalStorage } from "node:async_hooks"

import { db } from "./database.client"

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Propagates the active Drizzle transaction through one asynchronous request.
 *
 * Cross-cutting wrappers such as idempotency start the root transaction. Domain
 * services call {@link transaction}; when a root already exists they join it,
 * otherwise they create their own. This keeps domain writes, audits, and
 * idempotency persistence on one commit boundary without coupling either layer
 * to the other.
 */
class DatabaseTransactionContext {
	private readonly storage = new AsyncLocalStorage<DatabaseTransaction>()

	transaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
		const active = this.storage.getStore()
		if (active) return work(active)

		return db.transaction(tx => this.storage.run(tx, () => work(tx)))
	}
}

export const databaseTransactionContext = new DatabaseTransactionContext()
