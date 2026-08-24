"use client"

import { useRef, useState, type FormEvent } from "react"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	usePisoCampAdminConfigQuery,
	useUpdatePisoCampAdminConfigMutation,
} from "@/features/pisocamp-admin/api/pisocamp-config.hooks"

const FIELD_ID = "session-inactivity-minutes"
const ERROR_ID = `${FIELD_ID}-error`

export function ModuleConfigurationView() {
	const config = usePisoCampAdminConfigQuery()

	return (
		<div className="space-y-6">
			<PageHeader
				title="Module Configuration"
				description="Manage the online session controls for Piso CAMP."
			/>

			{config.isPending ? (
				<div role="status" aria-label="Loading configuration" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading configuration</span>
				</div>
			) : config.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load module configuration</AlertTitle>
					<AlertDescription>
						Check your connection or access, then try again.
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => config.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : config.data ? (
				<ModuleConfigurationForm initialMinutes={config.data.session_inactivity_minutes} />
			) : null}
		</div>
	)
}

function ModuleConfigurationForm({ initialMinutes }: { initialMinutes: number }) {
	const update = useUpdatePisoCampAdminConfigMutation()
	const [minutes, setMinutes] = useState(String(initialMinutes))
	const [validationError, setValidationError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSaved(false)
		const parsed = Number(minutes)
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
			setValidationError("Enter a whole number between 1 and 1,440 minutes.")
			inputRef.current?.focus()
			return
		}

		setValidationError(null)
		update.mutate(
			{ session_inactivity_minutes: parsed },
			{
				onSuccess: () => setSaved(true),
			}
		)
	}

	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Session inactivity</CardTitle>
				<CardDescription>
					Choose how long an inactive signed-in session remains available.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-5" onSubmit={submit} noValidate>
					<div className="space-y-2">
						<Label htmlFor={FIELD_ID}>Session inactivity (minutes)</Label>
						<Input
							ref={inputRef}
							id={FIELD_ID}
							name="session_inactivity_minutes"
							autoComplete="off"
							type="number"
							min={1}
							max={1440}
							step={1}
							value={minutes}
							onChange={event => setMinutes(event.target.value)}
							aria-invalid={validationError ? true : undefined}
							aria-describedby={validationError ? ERROR_ID : undefined}
						/>
						{validationError ? (
							<p id={ERROR_ID} role="alert" className="text-destructive text-sm">
								{validationError}
							</p>
						) : null}
					</div>

					{update.isError ? (
						<Alert variant="destructive">
							<AlertTitle>Could not save configuration</AlertTitle>
							<AlertDescription>Your changes were not saved. Please try again.</AlertDescription>
						</Alert>
					) : null}
					{saved ? (
						<p role="status" className="text-sm text-green-700 dark:text-green-400">
							Configuration saved.
						</p>
					) : null}

					<Button type="submit" disabled={update.isPending}>
						{update.isPending ? "Saving…" : "Save Configuration"}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}
