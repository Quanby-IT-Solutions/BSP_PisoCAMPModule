"use client"

import { useState, type FormEvent } from "react"

import {
	SURVEY_TRIGGER_TYPES,
	type PisoCampSurveyTriggerRule,
	type PisoCampSurveyTriggerType,
} from "@repo/contracts"

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	useDeletePisoCampSurveyTriggerMutation,
	usePisoCampSurveyTriggersQuery,
	useUpsertPisoCampSurveyTriggerMutation,
} from "@/features/pisocamp-admin/api/survey-triggers.hooks"

const TRIGGER_LABELS: Record<PisoCampSurveyTriggerType, string> = {
	page_depth: "Page depth",
	activity_completion: "Activity completion",
	topic_completion: "Topic completion",
	module_exit: "Module exit",
	app_exit: "App exit",
}

function isTriggerType(value: unknown): value is PisoCampSurveyTriggerType {
	return SURVEY_TRIGGER_TYPES.some(type => type === value)
}

export function SurveyTriggersView() {
	const triggers = usePisoCampSurveyTriggersQuery()

	return (
		<div className="space-y-6">
			<PageHeader
				title="Survey Triggers"
				description="Decide when each published survey is offered, how often, and which one wins."
			/>

			{triggers.isPending ? (
				<div role="status" aria-label="Loading survey triggers" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading survey triggers</span>
				</div>
			) : triggers.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load survey triggers</AlertTitle>
					<AlertDescription>
						Check your connection or access, then try again.
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => triggers.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<>
					<SurveyTriggerForm />
					<SurveyTriggerList rules={triggers.data?.rules ?? []} />
				</>
			)}
		</div>
	)
}

function SurveyTriggerForm() {
	const upsert = useUpsertPisoCampSurveyTriggerMutation()
	const [contentItemId, setContentItemId] = useState("")
	const [triggerType, setTriggerType] = useState<PisoCampSurveyTriggerType>("topic_completion")
	const [pageDepth, setPageDepth] = useState("")
	const [frequencyCapDays, setFrequencyCapDays] = useState("30")
	const [priority, setPriority] = useState("50")
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	const needsDepth = triggerType === "page_depth"

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setSaved(false)
		if (!contentItemId.trim()) {
			setError("Enter the ID of the published survey.")
			return
		}
		if (needsDepth && !pageDepth.trim()) {
			setError("A page-depth trigger needs a depth.")
			return
		}
		setError(null)
		upsert.mutate(
			{
				requestId: crypto.randomUUID(),
				contentItemId: contentItemId.trim(),
				triggerType,
				// A depth belongs only to a page-depth trigger, and a blank cap
				// means "no cap" rather than zero days.
				pageDepth: needsDepth ? Number(pageDepth) : null,
				frequencyCapDays: frequencyCapDays.trim() ? Number(frequencyCapDays) : null,
				priority: Number(priority),
				enabled: true,
			},
			{
				onSuccess: () => {
					setSaved(true)
					setContentItemId("")
				},
				onError: () =>
					setError("The rule was not saved. Check the survey is published, then try again."),
			}
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Add or replace a rule</CardTitle>
				<CardDescription>
					One rule per survey and trigger. Priority 1 is offered first; a cap is the number of
					days before the same survey may be offered again.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-4" onSubmit={submit}>
					<div className="grid min-w-0 gap-4 sm:grid-cols-2">
						<div className="min-w-0 space-y-2">
							<Label htmlFor="trigger-survey">Survey content ID</Label>
							<Input
								id="trigger-survey"
								name="contentItemId"
								className="min-h-11 w-full"
								value={contentItemId}
								onChange={event => setContentItemId(event.target.value)}
								aria-invalid={error ? true : undefined}
								aria-describedby={error ? "trigger-error" : undefined}
							/>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="trigger-type">Trigger</Label>
							<Select
								name="triggerType"
								value={triggerType}
								onValueChange={value => {
									if (isTriggerType(value)) setTriggerType(value)
								}}
							>
								<SelectTrigger id="trigger-type" wrapValue className="min-h-11 w-full">
									<SelectValue>{TRIGGER_LABELS[triggerType]}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{SURVEY_TRIGGER_TYPES.map(type => (
										<SelectItem key={type} value={type}>
											{TRIGGER_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{needsDepth ? (
							<div className="min-w-0 space-y-2">
								<Label htmlFor="trigger-depth">Page depth</Label>
								<Input
									id="trigger-depth"
									name="pageDepth"
									type="number"
									inputMode="numeric"
									min={1}
									max={50}
									className="min-h-11 w-full"
									value={pageDepth}
									onChange={event => setPageDepth(event.target.value)}
								/>
							</div>
						) : null}
						<div className="min-w-0 space-y-2">
							<Label htmlFor="trigger-cap">Frequency cap (days)</Label>
							<Input
								id="trigger-cap"
								name="frequencyCapDays"
								type="number"
								inputMode="numeric"
								min={1}
								max={365}
								className="min-h-11 w-full"
								value={frequencyCapDays}
								onChange={event => setFrequencyCapDays(event.target.value)}
								aria-describedby="trigger-cap-help"
							/>
							<p id="trigger-cap-help" className="text-muted-foreground text-sm">
								Leave blank to offer it every time the trigger fires.
							</p>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="trigger-priority">Priority</Label>
							<Input
								id="trigger-priority"
								name="priority"
								type="number"
								inputMode="numeric"
								min={1}
								max={100}
								className="min-h-11 w-full"
								value={priority}
								onChange={event => setPriority(event.target.value)}
								aria-describedby="trigger-priority-help"
							/>
							<p id="trigger-priority-help" className="text-muted-foreground text-sm">
								1 is offered first when more than one survey is eligible.
							</p>
						</div>
					</div>

					{error ? (
						<p id="trigger-error" role="alert" className="text-destructive text-sm">
							{error}
						</p>
					) : null}
					{saved ? (
						<p role="status" className="text-sm">
							Rule saved. Devices pick it up with the next configuration read.
						</p>
					) : null}

					<Button type="submit" className="min-h-11" disabled={upsert.isPending}>
						{upsert.isPending ? "Saving…" : "Save Rule"}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}

function SurveyTriggerList({ rules }: { rules: PisoCampSurveyTriggerRule[] }) {
	const remove = useDeletePisoCampSurveyTriggerMutation()

	if (!rules.length) {
		return (
			<Alert>
				<AlertTitle>No survey triggers yet</AlertTitle>
				<AlertDescription>
					Until a rule exists, no survey is offered on a device.
				</AlertDescription>
			</Alert>
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Current rules</CardTitle>
				<CardDescription>Highest priority first.</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 overflow-x-auto">
				<table className="w-full min-w-0 text-sm">
					<caption className="sr-only">Survey trigger rules, highest priority first</caption>
					<thead>
						<tr className="text-left">
							<th scope="col" className="py-2 pr-4">
								Survey
							</th>
							<th scope="col" className="py-2 pr-4">
								Trigger
							</th>
							<th scope="col" className="py-2 pr-4">
								Cap
							</th>
							<th scope="col" className="py-2 pr-4">
								Priority
							</th>
							<th scope="col" className="py-2">
								Actions
							</th>
						</tr>
					</thead>
					<tbody>
						{rules.map(rule => (
							<tr key={rule.id} className="border-t">
								<td className="py-2 pr-4 break-words">{rule.surveyTitle}</td>
								<td className="py-2 pr-4">
									{TRIGGER_LABELS[rule.triggerType]}
									{rule.pageDepth === null ? "" : ` (${rule.pageDepth} deep)`}
								</td>
								<td className="py-2 pr-4">
									{rule.frequencyCapDays === null
										? "Every time"
										: `Once per ${rule.frequencyCapDays} days`}
								</td>
								<td className="py-2 pr-4">{rule.priority}</td>
								<td className="py-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="min-h-11"
										disabled={remove.isPending}
										onClick={() =>
											remove.mutate({
												requestId: crypto.randomUUID(),
												contentItemId: rule.contentItemId,
												triggerType: rule.triggerType,
											})
										}
									>
										Remove {rule.surveyTitle} {TRIGGER_LABELS[rule.triggerType]} rule
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</CardContent>
		</Card>
	)
}
