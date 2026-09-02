"use client"

import { useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import type {
	PisoCampContentStatus,
	PisoCampContentSummary,
	PisoCampContentType,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/core/components/ui/empty"
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { usePisoCampContentListQuery } from "@/features/pisocamp-content-admin/api/content.hooks"

const CONTENT_TYPE_FILTERS: readonly {
	value: PisoCampContentType | "all"
	label: string
}[] = [
	{ value: "all", label: "All content types" },
	{ value: "banknote", label: "Banknote" },
	{ value: "coin", label: "Coin" },
	{ value: "security_feature", label: "Security feature" },
	{ value: "advisory", label: "Advisory" },
	{ value: "link", label: "Link" },
	{ value: "trivia_question", label: "Trivia question" },
]
const STATUS_FILTERS: readonly { value: PisoCampContentStatus | "all"; label: string }[] = [
	{ value: "all", label: "All statuses" },
	{ value: "draft", label: "Draft" },
	{ value: "submitted_for_review", label: "Submitted for review" },
	{ value: "approved", label: "Approved" },
	{ value: "published", label: "Published" },
	{ value: "unpublished", label: "Unpublished" },
	{ value: "deactivated", label: "Deactivated" },
	{ value: "archived", label: "Archived" },
]
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: "UTC",
})
const titleCase = (value: string) =>
	value
		.split("_")
		.map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(" ")
const formatDate = (value: string) => DATE_FORMATTER.format(new Date(value))

function isContentType(value: string | null): value is PisoCampContentType {
	return CONTENT_TYPE_FILTERS.some(option => option.value === value && value !== "all")
}

function isContentStatus(value: string | null): value is PisoCampContentStatus {
	return STATUS_FILTERS.some(option => option.value === value && value !== "all")
}

const DIFFICULTY_FILTERS = [
	{ value: "all", label: "All difficulties" },
	{ value: "easy", label: "Easy" },
	{ value: "medium", label: "Medium" },
	{ value: "hard", label: "Hard" },
] as const

function isTriviaDifficulty(value: unknown): value is "easy" | "medium" | "hard" {
	return value === "easy" || value === "medium" || value === "hard"
}

function positivePage(value: string | null) {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? page : 1
}

export function ContentListView() {
	const pathname = usePathname()
	const router = useRouter()
	const searchParams = useSearchParams()
	const searchRef = useRef<HTMLInputElement>(null)
	const categoryRef = useRef<HTMLInputElement>(null)
	const contentTypeParam = searchParams.get("contentType")
	const statusParam = searchParams.get("status")
	const contentType = isContentType(contentTypeParam) ? contentTypeParam : undefined
	const status = isContentStatus(statusParam) ? statusParam : undefined
	const search = searchParams.get("search")?.trim() || undefined
	const page = positivePage(searchParams.get("page"))
	// GM-1: a question pool is browsed by subject and difficulty, so those
	// filters are offered only while questions are what is being listed.
	const showsQuestions = contentType === "trivia_question"
	const category = showsQuestions
		? (searchParams.get("category")?.trim() || undefined)
		: undefined
	const difficultyParam = searchParams.get("difficulty")
	const difficulty =
		showsQuestions && isTriviaDifficulty(difficultyParam) ? difficultyParam : undefined
	const content = usePisoCampContentListQuery({
		page,
		limit: 20,
		...(contentType ? { contentType } : {}),
		...(status ? { status } : {}),
		...(category ? { category } : {}),
		...(difficulty ? { difficulty } : {}),
		...(search ? { search } : {}),
	})

	function updateUrl(changes: Record<string, string | undefined>) {
		const next = new URLSearchParams(searchParams.toString())
		for (const [key, value] of Object.entries(changes)) {
			if (value) next.set(key, value)
			else next.delete(key)
		}
		const query = next.toString()
		router.replace(query ? `${pathname}?${query}` : pathname)
	}

	return (
		<div data-testid="content-list-layout" className="max-w-full min-w-0 space-y-6">
			<PageHeader
				title="Piso CAMP Content"
				description="Create and maintain factual public-information drafts."
				wrapTitle
				actions={<Button render={<Link href="/pisocamp/content/new" />}>Create Content</Button>}
			/>

			<div className="grid min-w-0 gap-4 rounded-xl border p-4 sm:grid-cols-3">
				<form
					role="search"
					className="min-w-0 space-y-2"
					onSubmit={event => {
						event.preventDefault()
						updateUrl({ search: searchRef.current?.value.trim() || undefined, page: undefined })
					}}
				>
					<Label htmlFor="content-search">Search</Label>
					<div className="flex min-w-0 flex-wrap gap-2">
						<Input
							key={search ?? "empty-search"}
							ref={searchRef}
							id="content-search"
							name="search"
							type="search"
							autoComplete="off"
							defaultValue={search}
							placeholder="Search by title…"
						/>
						<Button type="submit" variant="outline" className="h-auto min-h-8 whitespace-normal">
							Apply Search
						</Button>
					</div>
				</form>
				<div className="min-w-0 space-y-2">
					<Label htmlFor="content-type-filter">Content type</Label>
					<Select
						name="contentType"
						value={contentType ?? "all"}
						onValueChange={value => {
							if (typeof value !== "string") return
							updateUrl({
								contentType: value === "all" ? undefined : value,
								page: undefined,
							})
						}}
					>
						<SelectTrigger id="content-type-filter" wrapValue className="w-full">
							<SelectValue>
								{
									CONTENT_TYPE_FILTERS.find(option => option.value === (contentType ?? "all"))
										?.label
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{CONTENT_TYPE_FILTERS.map(option => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="min-w-0 space-y-2">
					<Label htmlFor="content-status-filter">Status</Label>
					<Select
						name="status"
						value={status ?? "all"}
						onValueChange={value => {
							if (typeof value !== "string") return
							updateUrl({ status: value === "all" ? undefined : value, page: undefined })
						}}
					>
						<SelectTrigger id="content-status-filter" wrapValue className="w-full">
							<SelectValue>
								{STATUS_FILTERS.find(option => option.value === (status ?? "all"))?.label}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{STATUS_FILTERS.map(option => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{showsQuestions ? (
				<div className="grid min-w-0 gap-4 rounded-xl border p-4 sm:grid-cols-2">
					<form
						className="min-w-0 space-y-2"
						onSubmit={event => {
							event.preventDefault()
							updateUrl({
								category: categoryRef.current?.value.trim() || undefined,
								page: undefined,
							})
						}}
					>
						<Label htmlFor="content-category-filter">Category</Label>
						<div className="flex min-w-0 flex-wrap gap-2">
							<Input
								key={category ?? "empty-category"}
								ref={categoryRef}
								id="content-category-filter"
								name="category"
								autoComplete="off"
								defaultValue={category}
								placeholder="security-features"
							/>
							<Button
								type="submit"
								variant="outline"
								className="h-auto min-h-8 whitespace-normal"
							>
								Apply Category
							</Button>
						</div>
					</form>
					<div className="min-w-0 space-y-2">
						<Label htmlFor="content-difficulty-filter">Difficulty</Label>
						<Select
							name="difficulty"
							value={difficulty ?? "all"}
							onValueChange={value => {
								if (typeof value !== "string") return
								updateUrl({
									difficulty: value === "all" ? undefined : value,
									page: undefined,
								})
							}}
						>
							<SelectTrigger id="content-difficulty-filter" wrapValue className="w-full">
								<SelectValue>
									{DIFFICULTY_FILTERS.find(
										option => option.value === (difficulty ?? "all")
									)?.label}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{DIFFICULTY_FILTERS.map(option => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			) : null}

			{content.isPending ? (
				<div role="status" aria-label="Loading content…" className="space-y-3">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-24 w-full" />
					<span className="sr-only">Loading content…</span>
				</div>
			) : content.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load content</AlertTitle>
					<AlertDescription>
						Check your connection and access, then try again.
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => content.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : content.data?.items.length ? (
				<div className="space-y-4">
					<ContentResults items={content.data.items} />
					<ContentPagination
						page={content.data.page}
						limit={content.data.limit}
						total={content.data.total}
						onPageChange={nextPage =>
							updateUrl({ page: nextPage === 1 ? undefined : String(nextPage) })
						}
					/>
				</div>
			) : (
				<Empty className="border py-12">
					<EmptyHeader>
						<EmptyTitle>No content items found</EmptyTitle>
						<EmptyDescription>Adjust the filters or create a new content draft.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	)
}

function ContentPagination({
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
	if (pageCount === 1) return null
	return (
		<nav
			aria-label="Content pagination"
			className="flex flex-wrap items-center justify-between gap-3"
		>
			<p className="text-muted-foreground text-sm tabular-nums">
				Page {page} of {pageCount}
			</p>
			<div className="flex gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
				>
					Previous Page
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={page >= pageCount}
					onClick={() => onPageChange(page + 1)}
				>
					Next Page
				</Button>
			</div>
		</nav>
	)
}

function ContentResults({ items }: { items: PisoCampContentSummary[] }) {
	return (
		<>
			<div data-testid="content-cards" className="grid min-w-0 gap-3 md:hidden">
				{items.map(item => (
					<Card key={item.id} size="sm" className="min-w-0">
						<CardHeader>
							<CardTitle as="h2" className="break-words">
								{item.title}
							</CardTitle>
							<Badge variant="secondary">{titleCase(item.status)}</Badge>
						</CardHeader>
						<CardContent className="grid min-w-0 gap-2 text-sm">
							<p>
								<span className="text-muted-foreground">Creator:</span> {item.creator.name}
							</p>
							<p>
								<span className="text-muted-foreground">Last editor:</span> {item.lastEditor.name}
							</p>
							<p>
								<span className="text-muted-foreground">Modified:</span>{" "}
								{formatDate(item.dateModified)}
							</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-2 w-fit"
								render={
									<Link
										href={`/pisocamp/content/${item.id}/edit`}
										aria-label={`Edit ${item.title}`}
									/>
								}
							>
								Edit
							</Button>
						</CardContent>
					</Card>
				))}
			</div>

			<div data-testid="content-table" className="hidden min-w-0 md:block">
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
								<TableCell>{formatDate(item.dateModified)}</TableCell>
								<TableCell>
									<Button
										variant="outline"
										size="sm"
										render={
											<Link
												href={`/pisocamp/content/${item.id}/edit`}
												aria-label={`Edit ${item.title}`}
											/>
										}
									>
										Edit
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</>
	)
}
