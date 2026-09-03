"use client"

import { useState, type FormEvent } from "react"

import type {
	DeletePisoCampSubjectDataOutput,
	PisoCampAccount,
	PisoCampRole,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import {
	useDeletePisoCampSubjectDataMutation,
	usePisoCampAccountsQuery,
	usePisoCampRolesQuery,
	useSetPisoCampAccountStatusMutation,
	useSetPisoCampUserRolesMutation,
} from "@/features/pisocamp-admin/api/accounts.hooks"

const PAGE_SIZE = 20

const STATUS_FILTERS = [
	{ value: "", label: "All" },
	{ value: "active", label: "Active" },
	{ value: "deactivated", label: "Deactivated" },
] as const

export function AccountManagementView() {
	const [search, setSearch] = useState("")
	const [draftSearch, setDraftSearch] = useState("")
	const [status, setStatus] = useState<"" | "active" | "deactivated">("")
	const [page, setPage] = useState(1)
	const [pending, setPending] = useState<PisoCampAccount | null>(null)
	const [editingRoles, setEditingRoles] = useState<PisoCampAccount | null>(null)
	const [deleting, setDeleting] = useState<PisoCampAccount | null>(null)

	const accounts = usePisoCampAccountsQuery({
		page,
		limit: PAGE_SIZE,
		...(search ? { search } : {}),
		...(status ? { status } : {}),
	})
	const setAccountStatus = useSetPisoCampAccountStatusMutation()
	const setUserRoles = useSetPisoCampUserRolesMutation()
	const deleteData = useDeletePisoCampSubjectDataMutation()

	function applySearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setPage(1)
		setSearch(draftSearch.trim())
	}

	const total = accounts.data?.total ?? 0
	const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

	return (
		<div className="space-y-6">
			<PageHeader
				title="Accounts"
				description="Withdraw or restore access without removing anybody's history."
			/>

			<Card>
				<CardHeader>
					<CardTitle>Find an account</CardTitle>
					<CardDescription>Search by name or email address.</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-wrap items-end gap-4" onSubmit={applySearch}>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="account-search">Search</Label>
							<Input
								id="account-search"
								name="search"
								className="min-h-11"
								autoComplete="off"
								value={draftSearch}
								onChange={event => setDraftSearch(event.target.value)}
							/>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="account-status">Status</Label>
							<select
								id="account-status"
								name="status"
								className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
								value={status}
								onChange={event => {
									setPage(1)
									setStatus(event.target.value as "" | "active" | "deactivated")
								}}
							>
								{STATUS_FILTERS.map(option => (
									<option key={option.label} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>
						<Button type="submit" className="min-h-11">
							Search
						</Button>
					</form>
				</CardContent>
			</Card>

			{setAccountStatus.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not change the account status</AlertTitle>
					<AlertDescription>{setAccountStatus.error.message}</AlertDescription>
				</Alert>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Accounts</CardTitle>
					<CardDescription>
						Deactivating ends every open session and refuses new sign-ins. Nothing is
						deleted.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					{accounts.isPending ? (
						<div role="status" aria-label="Loading accounts" className="space-y-3">
							<Skeleton className="h-32 w-full" />
							<span className="sr-only">Loading accounts</span>
						</div>
					) : accounts.isError || !accounts.data ? (
						<Alert variant="destructive">
							<AlertTitle>Could not load accounts</AlertTitle>
							<AlertDescription>
								Check your connection or access, then try again.
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="mt-3"
									onClick={() => accounts.refetch()}
								>
									Try Again
								</Button>
							</AlertDescription>
						</Alert>
					) : accounts.data.accounts.length === 0 ? (
						<p className="text-muted-foreground text-sm">No account matches that search.</p>
					) : (
						<Table>
							<TableCaption className="sr-only">
								Accounts with their current status
							</TableCaption>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Email</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Reason</TableHead>
									<TableHead>Roles</TableHead>
									<TableHead>Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{accounts.data.accounts.map(account => (
									<TableRow key={account.id}>
										<TableCell>{account.name}</TableCell>
										<TableCell>{account.email}</TableCell>
										<TableCell>
											<Badge
												variant={
													account.status === "deactivated" ? "destructive" : "secondary"
												}
											>
												{account.status === "deactivated" ? "Deactivated" : "Active"}
											</Badge>
										</TableCell>
										<TableCell>{account.reason ?? "—"}</TableCell>
										<TableCell>
											<span className="flex flex-wrap items-center gap-2">
												<span>{account.roles.length === 0 ? "None" : account.roles.join(", ")}</span>
												<Button
													type="button"
													variant="outline"
													size="sm"
													className="min-h-11"
													onClick={() => setEditingRoles(account)}
												>
													Edit Roles
												</Button>
											</span>
										</TableCell>
										<TableCell>
											{account.status === "deactivated" ? (
												<Button
													type="button"
													variant="outline"
													className="min-h-11"
													disabled={setAccountStatus.isPending}
													onClick={() =>
														setAccountStatus.mutate({
															accountId: account.id,
															status: "active",
														})
													}
												>
													Reactivate
												</Button>
											) : (
												<Button
													type="button"
													variant="outline"
													className="min-h-11"
													onClick={() => setPending(account)}
												>
													Deactivate
												</Button>
											)}
											<Button
												type="button"
												variant="outline"
												className="ml-2 min-h-11"
												onClick={() => setDeleting(account)}
											>
												Delete Data
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{total > PAGE_SIZE ? (
				<nav className="flex items-center gap-4" aria-label="Account pages">
					<Button
						type="button"
						variant="outline"
						className="min-h-11"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
					>
						Previous
					</Button>
					<p className="text-sm">
						Page {page} of {lastPage}
					</p>
					<Button
						type="button"
						variant="outline"
						className="min-h-11"
						disabled={page >= lastPage}
						onClick={() => setPage(page + 1)}
					>
						Next
					</Button>
				</nav>
			) : null}

			<DeleteDataDialog
				account={deleting}
				pending={deleteData.isPending}
				error={deleteData.isError ? deleteData.error.message : null}
				result={deleteData.data ?? null}
				onCancel={() => {
					deleteData.reset()
					setDeleting(null)
				}}
				onConfirm={approvalReference => {
					if (!deleting) return
					deleteData.mutate({ accountId: deleting.id, approvalReference })
				}}
			/>

			<RolesDialog
				account={editingRoles}
				pending={setUserRoles.isPending}
				error={setUserRoles.isError ? setUserRoles.error.message : null}
				onCancel={() => setEditingRoles(null)}
				onConfirm={roleNames => {
					if (!editingRoles) return
					setUserRoles.mutate(
						{ userId: editingRoles.id, roles: roleNames },
						{ onSuccess: () => setEditingRoles(null) }
					)
				}}
			/>

			<DeactivateDialog
				account={pending}
				pending={setAccountStatus.isPending}
				onCancel={() => setPending(null)}
				onConfirm={reason => {
					if (!pending) return
					setAccountStatus.mutate(
						{ accountId: pending.id, status: "deactivated", reason },
						{ onSuccess: () => setPending(null) }
					)
				}}
			/>
		</div>
	)
}

/**
 * Deactivation asks first, and asks why.
 *
 * Ending somebody's access is not an accident anyone should be able to have by
 * clicking once, and the reason is what the audit trail — and the next person
 * to ask "why is this account locked" — actually needs.
 */
function DeactivateDialog({
	account,
	pending,
	onCancel,
	onConfirm,
}: {
	account: PisoCampAccount | null
	pending: boolean
	onCancel: () => void
	onConfirm: (reason: string) => void
}) {
	const [reason, setReason] = useState("")
	const [error, setError] = useState<string | null>(null)

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const trimmed = reason.trim()
		if (trimmed.length === 0) {
			setError("Give a reason, so the change can be explained later.")
			return
		}
		setError(null)
		onConfirm(trimmed)
	}

	return (
		<Dialog
			open={account !== null}
			onOpenChange={open => {
				if (!open) {
					setReason("")
					setError(null)
					onCancel()
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deactivate {account?.name}</DialogTitle>
					<DialogDescription>
						{account?.email} will be signed out of every device and refused at sign-in.
						Their history is kept.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={submit} noValidate>
					<div className="space-y-2">
						<Label htmlFor="deactivate-reason">Reason</Label>
						<Input
							id="deactivate-reason"
							name="reason"
							className="min-h-11"
							autoComplete="off"
							value={reason}
							onChange={event => setReason(event.target.value)}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? "deactivate-reason-error" : undefined}
						/>
						{error ? (
							<p id="deactivate-reason-error" role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="destructive"
							className="min-h-11"
							disabled={pending}
						>
							{pending ? "Deactivating…" : "Deactivate Account"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

/**
 * Which roles an account holds, and what each role would let them do.
 *
 * The permission keys are shown beside every role, read-only. An assignment
 * whose consequences nobody can see is not one anybody can review, and least
 * privilege is a claim you have to be able to check.
 */
function RolesDialog({
	account,
	pending,
	error,
	onCancel,
	onConfirm,
}: {
	account: PisoCampAccount | null
	pending: boolean
	error: string | null
	onCancel: () => void
	onConfirm: (roles: string[]) => void
}) {
	const catalogue = usePisoCampRolesQuery()
	const [selected, setSelected] = useState<string[] | null>(null)
	const held = selected ?? account?.roles ?? []

	function toggle(role: PisoCampRole, checked: boolean) {
		const next = checked ? [...held, role.name] : held.filter(name => name !== role.name)
		setSelected(next)
	}

	return (
		<Dialog
			open={account !== null}
			onOpenChange={open => {
				if (!open) {
					setSelected(null)
					onCancel()
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Roles for {account?.name}</DialogTitle>
					<DialogDescription>
						Each role carries the permission keys listed beneath it. Editing what a role
						contains is a separate change.
					</DialogDescription>
				</DialogHeader>

				{catalogue.isPending ? (
					<div role="status" aria-label="Loading roles">
						<Skeleton className="h-24 w-full" />
						<span className="sr-only">Loading roles</span>
					</div>
				) : catalogue.isError || !catalogue.data ? (
					<Alert variant="destructive">
						<AlertTitle>Could not load roles</AlertTitle>
						<AlertDescription>Check your connection or access, then try again.</AlertDescription>
					</Alert>
				) : (
					<fieldset className="max-h-80 space-y-3 overflow-y-auto">
						<legend className="sr-only">Roles</legend>
						{catalogue.data.roles.map(role => (
							<div key={role.name} className="flex min-h-11 items-start gap-3">
								<input
									id={`role-${role.name}`}
									type="checkbox"
									className="mt-1 size-5"
									checked={held.includes(role.name)}
									onChange={event => toggle(role, event.target.checked)}
								/>
								<Label htmlFor={`role-${role.name}`} className="flex flex-col items-start gap-1">
									<span>{role.name}</span>
									<span className="text-muted-foreground text-xs">
										{role.permissions.length === 0
											? "No permission keys"
											: role.permissions.join(", ")}
									</span>
								</Label>
							</div>
						))}
					</fieldset>
				)}

				{error ? (
					<Alert variant="destructive">
						<AlertTitle>Could not save roles</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				<DialogFooter>
					<Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						type="button"
						className="min-h-11"
						disabled={pending}
						onClick={() => onConfirm(held)}
					>
						{pending ? "Saving…" : "Save Roles"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

/**
 * Deleting somebody's data asks twice: what for, and are you sure.
 *
 * There is no undo. The dialog says exactly what will go and what will stay,
 * because "delete my data" and "delete my account" are different requests and
 * an administrator pressing this should know which one they are answering.
 */
function DeleteDataDialog({
	account,
	pending,
	error,
	result,
	onCancel,
	onConfirm,
}: {
	account: PisoCampAccount | null
	pending: boolean
	error: string | null
	result: DeletePisoCampSubjectDataOutput | null
	onCancel: () => void
	onConfirm: (approvalReference: string) => void
}) {
	const [reference, setReference] = useState("")
	const [problem, setProblem] = useState<string | null>(null)

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const trimmed = reference.trim()
		if (trimmed.length === 0) {
			setProblem("Give the BSP approval reference this deletion was authorised under.")
			return
		}
		setProblem(null)
		onConfirm(trimmed)
	}

	return (
		<Dialog
			open={account !== null}
			onOpenChange={open => {
				if (!open) {
					setReference("")
					setProblem(null)
					onCancel()
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete {account?.name}&apos;s data</DialogTitle>
					<DialogDescription>
						Their profile, device links and trivia answers are removed and their sessions
						ended. Their consent records are kept as proof that collection was lawful, and
						usage analytics are kept because they were never linked to this person. This
						cannot be undone.
					</DialogDescription>
				</DialogHeader>

				{result ? (
					<div className="space-y-2 text-sm">
						<p role="status">Data deleted.</p>
						<ul className="text-muted-foreground list-disc pl-5">
							<li>Profile removed: {result.profileDeleted ? "yes" : "none was stored"}</li>
							<li>Sessions ended: {result.sessionsEnded}</li>
							<li>Device links removed: {result.deviceLinksRemoved}</li>
							<li>Trivia answers deleted: {result.triviaResponsesDeleted}</li>
							<li>Survey answers unlinked: {result.surveyResponsesPseudonymised}</li>
							<li>Consent records kept: {result.consentRecordsRetained}</li>
						</ul>
					</div>
				) : (
					<form className="space-y-4" onSubmit={submit} noValidate>
						<div className="space-y-2">
							<Label htmlFor="deletion-approval">BSP approval reference</Label>
							<Input
								id="deletion-approval"
								name="approvalReference"
								className="min-h-11"
								autoComplete="off"
								value={reference}
								onChange={event => setReference(event.target.value)}
								aria-invalid={problem ? true : undefined}
								aria-describedby={problem ? "deletion-approval-error" : undefined}
							/>
							{problem ? (
								<p id="deletion-approval-error" role="alert" className="text-destructive text-sm">
									{problem}
								</p>
							) : null}
						</div>

						{error ? (
							<Alert variant="destructive">
								<AlertTitle>Could not delete the data</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}

						<DialogFooter>
							<Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="destructive"
								className="min-h-11"
								disabled={pending}
							>
								{pending ? "Deleting…" : "Delete Data"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}
