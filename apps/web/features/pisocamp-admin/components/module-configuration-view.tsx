"use client"

import { useRef, useState, type FormEvent } from "react"

import type { PisoCampAdminConfig } from "@repo/contracts"

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

type SettingKey = keyof PisoCampAdminConfig

/**
 * The settings this form edits, declared once.
 *
 * Every one is a whole number in a range, so the field, its label, its help
 * text and its validation are written once over this list. A fourth setting is
 * a line here, not another copy of the same block.
 */
const SETTINGS: {
	key: SettingKey
	id: string
	label: string
	help: string
	min: number
	max: number
	error: string
}[] = [
	{
		key: "session_inactivity_minutes",
		id: "session-inactivity-minutes",
		label: "Session inactivity (minutes)",
		help: "How long a gap in activity ends a session in the engagement figures.",
		min: 1,
		max: 1440,
		error: "Enter a whole number between 1 and 1,440 minutes.",
	},
	{
		key: "exit_advisory_interval_hours",
		id: "exit-advisory-interval-hours",
		label: "Exit advisory interval (hours)",
		help: "How long before somebody leaving the module is shown the advisory again.",
		min: 1,
		max: 8760,
		error: "Enter a whole number of hours between 1 and 8,760.",
	},
	{
		key: "churn_inactivity_days",
		id: "churn-inactivity-days",
		label: "Churn inactivity (days)",
		help: "How long somebody has to be away before the retention report counts them as churned.",
		min: 1,
		max: 365,
		error: "Enter a whole number between 1 and 365 days.",
	},
]

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
				<ModuleConfigurationForm initial={config.data} />
			) : null}
		</div>
	)
}

function ModuleConfigurationForm({ initial }: { initial: PisoCampAdminConfig }) {
	const update = useUpdatePisoCampAdminConfigMutation()
	const [draft, setDraft] = useState<Record<SettingKey, string>>(
		() =>
			Object.fromEntries(SETTINGS.map(setting => [setting.key, String(initial[setting.key])])) as
				Record<SettingKey, string>
	)
	const [invalidKey, setInvalidKey] = useState<SettingKey | null>(null)
	const [saved, setSaved] = useState(false)
	const fields = useRef(new Map<SettingKey, HTMLInputElement | null>())

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSaved(false)

		const parsed = {} as Record<SettingKey, number>
		for (const setting of SETTINGS) {
			const value = Number(draft[setting.key])
			if (!Number.isInteger(value) || value < setting.min || value > setting.max) {
				// The first bad field takes the focus, so a keyboard user lands on
				// the thing the message is about.
				setInvalidKey(setting.key)
				fields.current.get(setting.key)?.focus()
				return
			}
			parsed[setting.key] = value
		}

		setInvalidKey(null)
		update.mutate(parsed, { onSuccess: () => setSaved(true) })
	}

	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Module settings</CardTitle>
				<CardDescription>
					The session, advisory and churn periods the module and its reports run on.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-5" onSubmit={submit} noValidate>
					{SETTINGS.map(setting => {
						const errorId = `${setting.id}-error`
						const helpId = `${setting.id}-help`
						const invalid = invalidKey === setting.key

						return (
							<div key={setting.key} className="space-y-2">
								<Label htmlFor={setting.id}>{setting.label}</Label>
								<Input
									ref={node => {
										fields.current.set(setting.key, node)
									}}
									id={setting.id}
									name={setting.key}
									autoComplete="off"
									type="number"
									min={setting.min}
									max={setting.max}
									step={1}
									value={draft[setting.key]}
									onChange={event =>
										setDraft({ ...draft, [setting.key]: event.target.value })
									}
									aria-invalid={invalid ? true : undefined}
									aria-describedby={invalid ? errorId : helpId}
								/>
								<p id={helpId} className="text-muted-foreground text-sm">
									{setting.help}
								</p>
								{invalid ? (
									<p id={errorId} role="alert" className="text-destructive text-sm">
										{setting.error}
									</p>
								) : null}
							</div>
						)
					})}

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
