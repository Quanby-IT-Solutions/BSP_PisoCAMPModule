"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { PisoCampContentDetail } from "@repo/contracts"

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
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	useCreatePisoCampContentMutation,
	usePisoCampContentDetailQuery,
	useUpdatePisoCampContentMutation,
} from "@/features/pisocamp-content-admin/api/content.hooks"
import { ContentTypeFields } from "@/features/pisocamp-content-admin/components/content-type-fields"
import { RelatedLinksEditor } from "@/features/pisocamp-content-admin/components/related-links-editor"
import {
	buildCreateContentRequest,
	buildUpdateContentRequest,
	createEmptyContentForm,
	getOrCreateRequestId,
	type ContentFormErrors,
	type ContentFormValues,
	type RelatedLinkFormValue,
} from "@/features/pisocamp-content-admin/lib/content-form"

type ContentFormViewProps = { mode: "create"; itemId?: never } | { mode: "edit"; itemId: string }
type ContentFormEditorProps =
	| { mode: "create"; itemId?: never; initialDetail?: never; reloadDetail?: never }
	| {
			mode: "edit"
			itemId: string
			initialDetail: PisoCampContentDetail
			reloadDetail: () => Promise<PisoCampContentDetail | undefined>
	  }

const EMPTY_ITEM_ID = "00000000-0000-4000-8000-000000000000"
const DIRTY_HISTORY_GUARD_KEY = "__pisoCampContentDirtyGuard"

function hasDirtyHistoryGuard(state: unknown) {
	return typeof state === "object" && state !== null && DIRTY_HISTORY_GUARD_KEY in state
}

function formValuesFromDetail(detail: PisoCampContentDetail): ContentFormValues {
	const content = detail.currentVersion.content
	const relatedLinks: RelatedLinkFormValue[] = detail.currentVersion.relatedLinks.map(link => ({
		clientId: link.id,
		kind: link.kind,
		label: link.label,
		value:
			link.kind === "external"
				? link.url
				: link.kind === "internal"
					? link.route
					: link.targetContentItemId,
	}))

	return {
		contentType: content.contentType,
		title: content.title,
		summary: content.summary,
		body: content.body ?? "",
		seriesCode:
			content.contentType === "banknote" ||
			content.contentType === "coin" ||
			content.contentType === "security_feature"
				? content.seriesCode
				: "",
		denominationCode:
			content.contentType === "banknote" ||
			content.contentType === "coin" ||
			content.contentType === "security_feature"
				? content.denominationCode
				: "",
		primaryUrl: content.contentType === "link" ? content.primaryUrl : "",
		relatedLinks,
	}
}

function isConflict(error: unknown) {
	if (!error || typeof error !== "object") return false
	return (
		("status" in error && error.status === 409) || ("code" in error && error.code === "CONFLICT")
	)
}

export function ContentFormView({ itemId, mode }: ContentFormViewProps) {
	const detail = usePisoCampContentDetailQuery({ itemId: itemId ?? EMPTY_ITEM_ID }, mode === "edit")

	if (mode === "edit" && detail.isPending) {
		return (
			<div role="status" aria-label="Loading content…" className="space-y-3">
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-96 w-full" />
				<span className="sr-only">Loading content…</span>
			</div>
		)
	}

	if (mode === "edit" && (detail.isError || !detail.data)) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load content</AlertTitle>
				<AlertDescription>
					Your draft could not be loaded. Try again before editing.
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => detail.refetch()}
					>
						Try Again
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	if (mode === "edit" && detail.data) {
		return (
			<ContentFormEditor
				mode="edit"
				itemId={itemId}
				initialDetail={detail.data}
				reloadDetail={async () => {
					const result = await detail.refetch()
					return result.status === "success" ? result.data : undefined
				}}
			/>
		)
	}

	return <ContentFormEditor mode="create" />
}

function ContentFormEditor({ itemId, mode, initialDetail, reloadDetail }: ContentFormEditorProps) {
	const router = useRouter()
	const routerRef = useRef(router)
	const createContent = useCreatePisoCampContentMutation()
	const updateContent = useUpdatePisoCampContentMutation()
	const [values, setValues] = useState(() =>
		initialDetail ? formValuesFromDetail(initialDetail) : createEmptyContentForm("advisory")
	)
	const [versionNo, setVersionNo] = useState(initialDetail?.currentVersion.versionNo ?? 0)
	const [errors, setErrors] = useState<ContentFormErrors>({})
	const [dirty, setDirty] = useState(false)
	const [conflict, setConflict] = useState(false)
	const [saveFailed, setSaveFailed] = useState(false)
	const [historyReady, setHistoryReady] = useState(true)
	const requestId = useRef<string | null>(null)
	const titleRef = useRef<HTMLInputElement>(null)
	const summaryRef = useRef<HTMLInputElement>(null)
	const bodyRef = useRef<HTMLTextAreaElement>(null)
	const primaryUrlRef = useRef<HTMLInputElement>(null)
	const seriesRef = useRef<HTMLButtonElement>(null)
	const denominationRef = useRef<HTMLButtonElement>(null)
	const relatedControlRefs = useRef(new Map<string, HTMLElement>())
	const leaveDirtyHistory = useRef<(navigate: () => void) => void>(navigate => navigate())
	const ownsDirtyHistoryGuard = useRef(false)
	const recoveringStaleHistory = useRef(false)

	useEffect(() => {
		routerRef.current = router
	}, [router])

	useEffect(() => {
		if (!dirty) ownsDirtyHistoryGuard.current = false
	}, [dirty])

	useEffect(() => {
		const reconcileStaleGuard = () => {
			if (recoveringStaleHistory.current || ownsDirtyHistoryGuard.current) return
			recoveringStaleHistory.current = true
			setHistoryReady(false)
			window.history.back()
		}
		const handleHistoryRecovery = (event: PopStateEvent) => {
			if (recoveringStaleHistory.current) {
				if (!hasDirtyHistoryGuard(event.state)) {
					recoveringStaleHistory.current = false
					setHistoryReady(true)
				}
				return
			}
			if (!dirty && hasDirtyHistoryGuard(event.state)) reconcileStaleGuard()
		}

		window.addEventListener("popstate", handleHistoryRecovery)
		if (hasDirtyHistoryGuard(window.history.state)) reconcileStaleGuard()
		return () => window.removeEventListener("popstate", handleHistoryRecovery)
	}, [dirty])

	useEffect(() => {
		if (!dirty || !historyReady || recoveringStaleHistory.current) return
		const currentState = window.history.state as unknown
		const hasGuardEntry = hasDirtyHistoryGuard(currentState)
		ownsDirtyHistoryGuard.current = true
		if (!hasGuardEntry) {
			window.history.pushState(
				{
					...(typeof currentState === "object" && currentState !== null ? currentState : {}),
					[DIRTY_HISTORY_GUARD_KEY]: true,
				},
				"",
				window.location.href
			)
		}
		let atGuardEntry = true
		let bypassNextPop = false
		let pendingNavigation: (() => void) | null = null
		const preventReload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			event.returnValue = ""
		}
		const preventAnchorNavigation = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return
			const element = event.target instanceof Element ? event.target.closest("a[href]") : null
			if (
				!(element instanceof HTMLAnchorElement) ||
				element.target === "_blank" ||
				element.hasAttribute("download")
			)
				return
			const destination = new URL(element.href, window.location.href)
			if (
				destination.origin !== window.location.origin ||
				destination.href === window.location.href
			)
				return
			if (!window.confirm("Discard your unsaved changes?")) {
				event.preventDefault()
				event.stopImmediatePropagation()
				return
			}
			event.preventDefault()
			event.stopImmediatePropagation()
			leaveDirtyHistory.current(() => {
				setDirty(false)
				const href = `${destination.pathname}${destination.search}${destination.hash}` as Route
				routerRef.current.push(href)
			})
		}
		const preventHistoryNavigation = (event: PopStateEvent) => {
			const state = event.state as unknown
			const isGuardEntry = hasDirtyHistoryGuard(state)
			atGuardEntry = isGuardEntry

			if (bypassNextPop) {
				bypassNextPop = false
				const navigate = pendingNavigation
				pendingNavigation = null
				navigate?.()
				return
			}
			if (isGuardEntry) return
			if (!window.confirm("Discard your unsaved changes?")) {
				bypassNextPop = true
				window.history.forward()
				return
			}
			setDirty(false)
			window.history.back()
		}
		const leave = (navigate: () => void) => {
			if (!atGuardEntry) {
				navigate()
				return
			}
			pendingNavigation = navigate
			bypassNextPop = true
			window.history.back()
		}
		leaveDirtyHistory.current = leave
		window.addEventListener("beforeunload", preventReload)
		document.addEventListener("click", preventAnchorNavigation, true)
		window.addEventListener("popstate", preventHistoryNavigation)
		return () => {
			window.removeEventListener("beforeunload", preventReload)
			document.removeEventListener("click", preventAnchorNavigation, true)
			window.removeEventListener("popstate", preventHistoryNavigation)
			if (leaveDirtyHistory.current === leave) {
				leaveDirtyHistory.current = navigate => navigate()
			}
		}
	}, [dirty, historyReady])

	const pending = createContent.isPending || updateContent.isPending
	const changeValues = (next: ContentFormValues) => {
		setValues(next)
		setDirty(true)
		setErrors({})
		setSaveFailed(false)
		requestId.current = null
	}

	function focusFirstInvalid(nextErrors: ContentFormErrors) {
		const focusTargets: [string, React.RefObject<HTMLElement | null>][] = [
			["title", titleRef],
			["summary", summaryRef],
			["body", bodyRef],
			["seriesCode", seriesRef],
			["denominationCode", denominationRef],
			["primaryUrl", primaryUrlRef],
		]
		const regularTarget = focusTargets.find(([key]) => nextErrors[key])?.[1].current
		if (regularTarget) {
			regularTarget.focus()
			return
		}
		const relatedKey = Object.keys(nextErrors).find(key => key.startsWith("relatedLinks."))
		if (relatedKey) relatedControlRefs.current.get(relatedKey)?.focus()
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (pending) return
		setConflict(false)
		setSaveFailed(false)
		requestId.current = getOrCreateRequestId(requestId.current)

		const callbacks = {
			onSuccess: () => {
				toast.success("Draft saved.")
				requestId.current = null
				leaveDirtyHistory.current(() => {
					setDirty(false)
					router.push("/pisocamp/content")
				})
			},
			onError: (error: Error) => {
				if (isConflict(error)) {
					setConflict(true)
					setSaveFailed(false)
				} else {
					setConflict(false)
					setSaveFailed(true)
				}
			},
		}
		if (mode === "create") {
			const result = buildCreateContentRequest(values, requestId.current)
			if (!result.success) {
				setErrors(result.errors)
				focusFirstInvalid(result.errors)
				return
			}
			setErrors({})
			createContent.mutate(result.data, callbacks)
			return
		}

		const result = buildUpdateContentRequest(values, {
			itemId,
			requestId: requestId.current,
			expectedVersionNo: versionNo,
		})
		if (!result.success) {
			setErrors(result.errors)
			focusFirstInvalid(result.errors)
			return
		}
		setErrors({})
		updateContent.mutate(result.data, callbacks)
	}

	async function reloadLatest() {
		if (mode !== "edit") return
		updateContent.reset()
		setSaveFailed(false)
		const result = await reloadDetail()
		if (!result) return
		setValues(formValuesFromDetail(result))
		setVersionNo(result.currentVersion.versionNo)
		leaveDirtyHistory.current(() => setDirty(false))
		setConflict(false)
		setErrors({})
		requestId.current = null
	}

	function cancel() {
		if (dirty && !window.confirm("Discard your unsaved changes?")) return
		leaveDirtyHistory.current(() => {
			setDirty(false)
			router.push("/pisocamp/content")
		})
	}

	return (
		<div data-testid="content-form-layout" className="w-full max-w-full min-w-0 space-y-6">
			<PageHeader
				title={mode === "create" ? "Create Content" : "Edit Content"}
				description="Save a validated draft for editorial review."
				wrapTitle
			/>
			<Card className="w-full max-w-4xl min-w-0 overflow-visible">
				<CardHeader className="min-w-0 px-[8px] sm:px-4">
					<CardTitle as="h2">Draft Details</CardTitle>
					<CardDescription>Required fields vary with the selected content type.</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 px-[8px] sm:px-4">
					<form noValidate className="w-full max-w-full min-w-0 space-y-6" onSubmit={submit}>
						<ContentTypeFields
							values={values}
							errors={errors}
							titleRef={titleRef}
							summaryRef={summaryRef}
							bodyRef={bodyRef}
							primaryUrlRef={primaryUrlRef}
							seriesRef={seriesRef}
							denominationRef={denominationRef}
							onChange={changeValues}
						/>
						<RelatedLinksEditor
							values={values}
							errors={errors}
							onControlRef={(key, element) => {
								if (element) relatedControlRefs.current.set(key, element)
								else relatedControlRefs.current.delete(key)
							}}
							onChange={relatedLinks => changeValues({ ...values, relatedLinks })}
						/>

						{conflict ? (
							<Alert variant="destructive">
								<AlertTitle>A newer version is available</AlertTitle>
								<AlertDescription>
									Your unsaved changes have not been overwritten. Reload the latest version before
									trying again.
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="mt-3"
										onClick={reloadLatest}
									>
										Reload Latest
									</Button>
								</AlertDescription>
							</Alert>
						) : null}
						{!conflict && (saveFailed || createContent.isError || updateContent.isError) ? (
							<Alert variant="destructive">
								<AlertTitle>Could not save draft</AlertTitle>
								<AlertDescription>
									Your changes remain in the form. Check your connection, then try again.
								</AlertDescription>
							</Alert>
						) : null}
						{pending ? (
							<p role="status" className="sr-only">
								Saving draft…
							</p>
						) : null}

						<div className="grid w-full min-w-0 gap-3 sm:flex sm:flex-wrap">
							<Button
								type="submit"
								disabled={pending}
								className="h-auto min-h-8 w-full whitespace-normal sm:w-auto"
							>
								{pending ? "Saving…" : "Save Draft"}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={cancel}
								className="h-auto min-h-8 w-full whitespace-normal sm:w-auto"
							>
								Cancel
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}
