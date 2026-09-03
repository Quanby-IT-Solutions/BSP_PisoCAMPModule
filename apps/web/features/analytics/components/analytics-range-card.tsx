"use client"

import { useState, type FormEvent } from "react"

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

export interface AnalyticsRange {
	from: string
	to: string
}

/** Today in Asia/Manila, which is the day every analytics surface counts by. */
export function manilaToday() {
	return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

export function daysBefore(date: string, days: number) {
	return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000)
		.toISOString()
		.slice(0, 10)
}

/**
 * The date range control every analytics dashboard uses.
 *
 * One control rather than one per dashboard: the validation, the labelling and
 * the 44px targets are the same requirement each time, and a second copy is a
 * second place for them to drift.
 */
export function AnalyticsRangeCard({
	idPrefix,
	initial,
	onApply,
	description = "Up to 366 days.",
}: {
	idPrefix: string
	initial: AnalyticsRange
	onApply: (range: AnalyticsRange) => void
	description?: string
}) {
	const [draft, setDraft] = useState(initial)
	const [error, setError] = useState<string | null>(null)

	function apply(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (draft.from > draft.to) {
			setError("The range must start on or before it ends.")
			return
		}
		setError(null)
		onApply(draft)
	}

	const errorId = `${idPrefix}-range-error`

	return (
		<Card>
			<CardHeader>
				<CardTitle>Date range</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="flex flex-wrap items-end gap-4" onSubmit={apply}>
					<div className="min-w-0 space-y-2">
						<Label htmlFor={`${idPrefix}-from`}>From</Label>
						<Input
							id={`${idPrefix}-from`}
							name="from"
							type="date"
							className="min-h-11"
							value={draft.from}
							onChange={event => setDraft({ ...draft, from: event.target.value })}
							aria-invalid={error ? true : undefined}
							aria-describedby={error ? errorId : undefined}
						/>
					</div>
					<div className="min-w-0 space-y-2">
						<Label htmlFor={`${idPrefix}-to`}>To</Label>
						<Input
							id={`${idPrefix}-to`}
							name="to"
							type="date"
							className="min-h-11"
							value={draft.to}
							onChange={event => setDraft({ ...draft, to: event.target.value })}
						/>
					</div>
					<Button type="submit" className="min-h-11">
						Apply Range
					</Button>
					{error ? (
						<p id={errorId} role="alert" className="text-destructive text-sm">
							{error}
						</p>
					) : null}
				</form>
			</CardContent>
		</Card>
	)
}
