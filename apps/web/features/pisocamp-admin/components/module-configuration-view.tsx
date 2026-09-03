"use client"

import { useRef, useState, type FormEvent } from "react"

import { KEY_ACTION_EVENTS, type PisoCampAdminConfig } from "@repo/contracts"

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
 * Each entry says how a value is asked for and how it is read back, so the
 * field, its label, its help text and its validation are written once over this
 * list. A new setting is a line here, not another copy of the same block.
 */
type SettingField =
	| { kind: "number"; step?: number; min: number; max: number }
	| { kind: "boolean" }
	| { kind: "text"; optional?: boolean }
	| { kind: "events" }
	| { kind: "ageGroups" }

interface Setting {
	key: SettingKey
	id: string
	label: string
	help: string
	error: string
	field: SettingField
}

const SETTINGS: Setting[] = [
	{
		key: "session_inactivity_minutes",
		id: "session-inactivity-minutes",
		label: "Session inactivity (minutes)",
		help: "How long a gap in activity ends a session in the engagement figures.",
		error: "Enter a whole number between 1 and 1,440 minutes.",
		field: { kind: "number", min: 1, max: 1440 },
	},
	{
		key: "exit_advisory_interval_hours",
		id: "exit-advisory-interval-hours",
		label: "Exit advisory interval (hours)",
		help: "How long before somebody leaving the module is shown the advisory again.",
		error: "Enter a whole number of hours between 1 and 8,760.",
		field: { kind: "number", min: 1, max: 8760 },
	},
	{
		key: "churn_inactivity_days",
		id: "churn-inactivity-days",
		label: "Churn inactivity (days)",
		help: "How long somebody has to be away before the retention report counts them as churned.",
		error: "Enter a whole number between 1 and 365 days.",
		field: { kind: "number", min: 1, max: 365 },
	},
	{
		key: "trivia_repeat_days",
		id: "trivia-repeat-days",
		label: "Trivia repeat window (days)",
		help: "How long before the same trivia question may be asked again.",
		error: "Enter a whole number between 1 and 365 days.",
		field: { kind: "number", min: 1, max: 365 },
	},
	{
		key: "leaderboard_enabled",
		id: "leaderboard-enabled",
		label: "Leaderboard enabled",
		help: "Whether the leaderboard is offered in the module at all.",
		error: "",
		field: { kind: "boolean" },
	},
	{
		key: "recognition_confidence_threshold",
		id: "recognition-confidence-threshold",
		label: "Recognition confidence threshold",
		help: "How sure the on-device model must be before it names a denomination.",
		error: "Enter a number between 0.5 and 1.",
		field: { kind: "number", min: 0.5, max: 1, step: 0.01 },
	},
	{
		key: "suppression_minimum",
		id: "suppression-minimum",
		label: "Small-group suppression minimum",
		help: "The smallest group whose demographic figures may be shown.",
		error: "Enter a whole number between 2 and 1,000.",
		field: { kind: "number", min: 2, max: 1000 },
	},
	{
		key: "key_action_events",
		id: "key-action-events",
		label: "Key actions",
		help: "Which events count as getting value from the module, for time-to-first-key-action.",
		error: "Choose at least one key action.",
		field: { kind: "events" },
	},
	{
		key: "age_group_buckets",
		id: "age-group-buckets",
		label: "Age groups",
		help: "Written as ranges, lowest first, with the last one open: 0-17, 18-24, 60+.",
		error: "Enter ranges in order that do not overlap, ending with an open one such as 60+.",
		field: { kind: "ageGroups" },
	},
	{
		key: "active_privacy_notice_version",
		id: "active-privacy-notice-version",
		label: "Active privacy notice version",
		help: "Which stored notice version consent is collected against. Leave empty for none.",
		error: "Enter the version of a stored privacy notice, or leave it empty.",
		field: { kind: "text", optional: true },
	},
]

/** `0-17, 18-24, 60+` as the boundaries the contract stores. */
function parseAgeGroups(text: string): PisoCampAdminConfig["age_group_buckets"] | null {
	const parts = text
		.split(",")
		.map(part => part.trim())
		.filter(part => part.length > 0)
	if (parts.length === 0) return null

	const buckets: PisoCampAdminConfig["age_group_buckets"] = []
	for (const part of parts) {
		const open = /^(\d{1,3})\+$/.exec(part)
		if (open) {
			buckets.push({ minAge: Number(open[1]), maxAge: null })
			continue
		}
		const closed = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(part)
		if (!closed) return null
		buckets.push({ minAge: Number(closed[1]), maxAge: Number(closed[2]) })
	}
	return buckets
}

function formatAgeGroups(buckets: PisoCampAdminConfig["age_group_buckets"]): string {
	return buckets
		.map(bucket => (bucket.maxAge === null ? `${bucket.minAge}+` : `${bucket.minAge}-${bucket.maxAge}`))
		.join(", ")
}

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
	const [draft, setDraft] = useState<PisoCampAdminConfig>(initial)
	const [text, setText] = useState<Record<string, string>>(() => ({
		age_group_buckets: formatAgeGroups(initial.age_group_buckets),
	}))
	const [invalidKey, setInvalidKey] = useState<SettingKey | null>(null)
	const [saved, setSaved] = useState(false)
	const fields = useRef(new Map<SettingKey, HTMLElement | null>())

	/** The first field that will not parse, so the message has somewhere to point. */
	function firstInvalid(next: PisoCampAdminConfig): SettingKey | null {
		for (const setting of SETTINGS) {
			const field = setting.field
			const value = next[setting.key]

			if (field.kind === "number") {
				const numeric = Number(value)
				const whole = field.step === undefined
				if (
					!Number.isFinite(numeric) ||
					(whole && !Number.isInteger(numeric)) ||
					numeric < field.min ||
					numeric > field.max
				) {
					return setting.key
				}
			}
			if (field.kind === "events" && (value as string[]).length === 0) return setting.key
			if (field.kind === "ageGroups" && parseAgeGroups(text.age_group_buckets ?? "") === null) {
				return setting.key
			}
			if (field.kind === "text" && !field.optional && String(value ?? "").trim() === "") {
				return setting.key
			}
		}
		return null
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSaved(false)

		const buckets = parseAgeGroups(text.age_group_buckets ?? "")
		const next: PisoCampAdminConfig = {
			...draft,
			age_group_buckets: buckets ?? draft.age_group_buckets,
		}

		const invalid = buckets === null ? "age_group_buckets" : firstInvalid(next)
		if (invalid) {
			// The first bad field takes the focus, so a keyboard user lands on
			// the thing the message is about.
			setInvalidKey(invalid)
			fields.current.get(invalid)?.focus()
			return
		}

		setInvalidKey(null)
		update.mutate(next, { onSuccess: () => setSaved(true) })
	}

	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Module settings</CardTitle>
				<CardDescription>
					Every Piso CAMP setting an administrator can change, with what it does.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-5" onSubmit={submit} noValidate>
					{SETTINGS.map(setting => {
						const errorId = `${setting.id}-error`
						const helpId = `${setting.id}-help`
						const invalid = invalidKey === setting.key
						const described = invalid ? errorId : helpId
						const field = setting.field

						return (
							<div key={setting.key} className="space-y-2">
								{field.kind === "boolean" ? (
									<div className="flex min-h-11 items-center gap-3">
										<input
											ref={node => {
												fields.current.set(setting.key, node)
											}}
											id={setting.id}
											name={setting.key}
											type="checkbox"
											className="size-5"
											checked={draft[setting.key] as boolean}
											onChange={event =>
												setDraft({ ...draft, [setting.key]: event.target.checked })
											}
											aria-describedby={described}
										/>
										<Label htmlFor={setting.id}>{setting.label}</Label>
									</div>
								) : (
									<Label htmlFor={setting.id}>{setting.label}</Label>
								)}

								{field.kind === "number" ? (
									<Input
										ref={node => {
											fields.current.set(setting.key, node)
										}}
										id={setting.id}
										name={setting.key}
										autoComplete="off"
										type="number"
										className="min-h-11"
										min={field.min}
										max={field.max}
										step={field.step ?? 1}
										value={String(draft[setting.key])}
										onChange={event =>
											setDraft({ ...draft, [setting.key]: Number(event.target.value) })
										}
										aria-invalid={invalid ? true : undefined}
										aria-describedby={described}
									/>
								) : null}

								{field.kind === "text" ? (
									<Input
										ref={node => {
											fields.current.set(setting.key, node)
										}}
										id={setting.id}
										name={setting.key}
										autoComplete="off"
										className="min-h-11"
										value={String(draft[setting.key] ?? "")}
										onChange={event =>
											setDraft({
												...draft,
												// Empty means "none", not the empty version.
												[setting.key]: event.target.value.trim() === "" ? null : event.target.value,
											})
										}
										aria-invalid={invalid ? true : undefined}
										aria-describedby={described}
									/>
								) : null}

								{field.kind === "ageGroups" ? (
									<Input
										ref={node => {
											fields.current.set(setting.key, node)
										}}
										id={setting.id}
										name={setting.key}
										autoComplete="off"
										className="min-h-11"
										value={text.age_group_buckets ?? ""}
										onChange={event =>
											setText({ ...text, age_group_buckets: event.target.value })
										}
										aria-invalid={invalid ? true : undefined}
										aria-describedby={described}
									/>
								) : null}

								{field.kind === "events" ? (
									<fieldset
										className="space-y-2"
										ref={node => {
											fields.current.set(setting.key, node)
										}}
									>
										<legend className="sr-only">{setting.label}</legend>
										{KEY_ACTION_EVENTS.map(event => {
											const held = draft.key_action_events as string[]
											return (
												<div key={event} className="flex min-h-11 items-center gap-3">
													<input
														id={`${setting.id}-${event}`}
														type="checkbox"
														className="size-5"
														checked={held.includes(event)}
														onChange={changed =>
															setDraft({
																...draft,
																key_action_events: (changed.target.checked
																	? [...held, event]
																	: held.filter(name => name !== event)) as
																	PisoCampAdminConfig["key_action_events"],
															})
														}
													/>
													<Label htmlFor={`${setting.id}-${event}`}>{event}</Label>
												</div>
											)
										})}
									</fieldset>
								) : null}

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
