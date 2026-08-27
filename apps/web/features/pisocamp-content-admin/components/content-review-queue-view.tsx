"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import type { PisoCampContentReviewQueueSummary } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader } from "@/core/components/ui/empty"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { cn } from "@/core/lib/utils"
import { usePisoCampContentReviewQueueQuery } from "@/features/pisocamp-content-admin/api/content.hooks"

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZone: "Asia/Manila",
})

function titleCase(value: string) {
	const label = value.split("_").join(" ")
	return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function ManilaTime({ value }: { value: string }) {
	return (
		<time dateTime={value}>
			{MANILA_DATE_FORMATTER.format(new Date(value))} <span>(Asia/Manila)</span>
		</time>
	)
}

function positivePage(value: string | null) {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

export function ContentReviewQueueView({ canReview }: { canReview: boolean }) {
	const pathname = usePathname()
	const router = useRouter()
	const searchParams = useSearchParams()
	const page = positivePage(searchParams.get("page"))
	const queue = usePisoCampContentReviewQueueQuery({ page, limit: 20 })

	function changePage(nextPage: number) {
		const next = new URLSearchParams(searchParams.toString())
		if (nextPage === 1) next.delete("page")
		else next.set("page", String(nextPage))
		const query = next.toString()
		router.replace(query ? `${pathname}?${query}` : pathname)
	}

	if (!canReview) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Review Access Unavailable</AlertTitle>
				<AlertDescription>You do not have permission to review content.</AlertDescription>
			</Alert>
		)
	}

	return (
		<div data-testid="content-review-queue-layout" className="w-full max-w-full min-w-0 space-y-6">
			<PageHeader
				title="Content Review"
				description="Review submitted snapshots and publish approved content."
				wrapTitle
			/>

			{queue.isPending ? (
				<div role="status" aria-label="Loading review queue…" className="space-y-3">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-24 w-full" />
					<span className="sr-only">Loading review queue…</span>
				</div>
			) : queue.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could Not Load the Review Queue</AlertTitle>
					<AlertDescription>
						Check your connection and access, then try again.
						<Button
							type="button"
							variant="outline"
							className="mt-3 min-h-11 touch-manipulation transition-colors"
							onClick={() => queue.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : queue.data?.items.length ? (
				<div className="space-y-4">
					<QueueResults items={queue.data.items} />
					<QueuePagination
						page={queue.data.page}
						limit={queue.data.limit}
						total={queue.data.total}
						onPageChange={changePage}
					/>
				</div>
			) : queue.data && queue.data.total > 0 ? (
				<div className="space-y-4">
					<Empty className="border py-12">
						<EmptyHeader>
							<h2 className="text-sm font-medium tracking-tight">
								No Review Items on Page {queue.data.page}
							</h2>
							<EmptyDescription>
								This page has no review items. Use pagination to return to an available page.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
					<QueuePagination
						page={queue.data.page}
						limit={queue.data.limit}
						total={queue.data.total}
						onPageChange={changePage}
					/>
				</div>
			) : (
				<Empty className="border py-12">
					<EmptyHeader>
						<h2 className="text-sm font-medium tracking-tight">Review Queue Is Empty</h2>
						<EmptyDescription>
							Submitted or approved content will appear here when action is required.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	)
}

function QueuePagination({
	page,
	limit,
	total,
	onPageChange,
}: {
	page: number
	limit: number
	total: number
	onPageChange: (page: number) => void
}) {
	const pageCount = Math.max(1, Math.ceil(total / limit))
	if (pageCount === 1 && page <= pageCount) return null

	return (
		<nav aria-label="Review queue pagination" className="flex flex-wrap items-center gap-3">
			<p className="text-muted-foreground mr-auto text-sm tabular-nums">
				Page {page} of {pageCount}
			</p>
			<Button
				type="button"
				variant="outline"
				className="min-h-11 touch-manipulation transition-colors"
				disabled={page <= 1}
				onClick={() => onPageChange(page - 1)}
			>
				Previous Page
			</Button>
			<Button
				type="button"
				variant="outline"
				className="min-h-11 touch-manipulation transition-colors"
				disabled={page >= pageCount}
				onClick={() => onPageChange(page + 1)}
			>
				Next Page
			</Button>
		</nav>
	)
}

function QueueResults({ items }: { items: PisoCampContentReviewQueueSummary[] }) {
	return (
		<>
			<div data-testid="review-queue-cards" className="grid min-w-0 gap-3 md:hidden">
				{items.map(item => (
					<Card key={item.id} size="sm" className="min-w-0">
						<CardHeader>
							<CardTitle as="h2" className="break-words">
								{item.title}
							</CardTitle>
							<Badge variant="secondary">{titleCase(item.status)}</Badge>
						</CardHeader>
						<CardContent className="grid min-w-0 gap-2 text-sm">
							<p className="min-w-0 break-words">
								<span className="text-muted-foreground">Creator:</span> {item.creator.name}
							</p>
							<p className="min-w-0 break-words">
								<span className="text-muted-foreground">Last editor:</span> {item.lastEditor.name}
							</p>
							<p className="min-w-0 break-words">
								<span className="text-muted-foreground">Modified:</span>{" "}
								<ManilaTime value={item.dateModified} />
							</p>
							<Link
								href={`/pisocamp/content/review/${item.id}`}
								aria-label={`Review ${item.title}`}
								className={cn(
									buttonVariants({ variant: "outline" }),
									"mt-2 min-h-11 w-fit touch-manipulation transition-colors"
								)}
							>
								Review
							</Link>
						</CardContent>
					</Card>
				))}
			</div>

			<div data-testid="review-queue-table" className="hidden min-w-0 md:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Title</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Creator</TableHead>
							<TableHead>Last editor</TableHead>
							<TableHead>Modified</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map(item => (
							<TableRow key={item.id}>
								<TableCell className="max-w-80 font-medium whitespace-normal">
									{item.title}
								</TableCell>
								<TableCell>
									<Badge variant="secondary">{titleCase(item.status)}</Badge>
								</TableCell>
								<TableCell>{item.creator.name}</TableCell>
								<TableCell>{item.lastEditor.name}</TableCell>
								<TableCell>
									<ManilaTime value={item.dateModified} />
								</TableCell>
								<TableCell>
									<Link
										href={`/pisocamp/content/review/${item.id}`}
										aria-label={`Review ${item.title}`}
										className={cn(
											buttonVariants({ variant: "outline" }),
											"min-h-11 touch-manipulation transition-colors"
										)}
									>
										Review
									</Link>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</>
	)
}
