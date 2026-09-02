import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PisoCampContentReviewDetail } from "@repo/contracts"

import { ContentLifecycleActions } from "./content-lifecycle-actions"

const { useUnpublish, useDeactivate, useArchive, useSchedule, toastSuccess } = vi.hoisted(() => ({
	useUnpublish: vi.fn(),
	useDeactivate: vi.fn(),
	useArchive: vi.fn(),
	useSchedule: vi.fn(),
	toastSuccess: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: toastSuccess } }))
vi.mock("@/features/pisocamp-content-admin/api/content.hooks", () => ({
	useUnpublishPisoCampContentMutation: () => useUnpublish(),
	useDeactivatePisoCampContentMutation: () => useDeactivate(),
	useArchivePisoCampContentMutation: () => useArchive(),
	useSchedulePisoCampContentPublicationMutation: () => useSchedule(),
}))

const ITEM_ID = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"

function detail(overrides: Partial<PisoCampContentReviewDetail> = {}) {
	return {
		id: ITEM_ID,
		contentType: "advisory",
		status: "published",
		publishAt: null,
		currentVersion: {
			id: "d7e9984f-fd54-49d9-bb33-0a7c006c83fd",
			versionNo: 4,
			status: "published",
			content: {
				contentType: "advisory",
				title: "Handle banknotes with care",
				summary: "Approved advisory copy.",
				body: "Do not fold, staple or write on Philippine banknotes.",
			},
			relatedLinks: [],
			createdBy: { id: "approver", name: "Sam Rivera" },
			createdAt: "2026-09-01T04:00:00.000Z",
			transition: { action: "publish", comments: null },
			approval: { actor: { id: "approver", name: "Sam Rivera" }, at: "2026-09-01T03:00:00.000Z" },
			publication: {
				actor: { id: "approver", name: "Sam Rivera" },
				at: "2026-09-01T04:00:00.000Z",
			},
		},
		creator: { id: "editor", name: "Elena Editor" },
		lastEditor: { id: "editor", name: "Elena Editor" },
		createdAt: "2026-09-01T00:00:00.000Z",
		dateModified: "2026-09-01T04:00:00.000Z",
		...overrides,
	} as PisoCampContentReviewDetail
}

function mutation(mutate = vi.fn()) {
	return { mutate, reset: vi.fn(), isPending: false, isError: false, error: null }
}

describe("ContentLifecycleActions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useUnpublish.mockReturnValue(mutation())
		useDeactivate.mockReturnValue(mutation())
		useArchive.mockReturnValue(mutation())
		useSchedule.mockReturnValue(mutation())
	})

	it("renders nothing without the publish permission", () => {
		const { container } = render(<ContentLifecycleActions canPublish={false} detail={detail()} />)

		expect(container).toBeEmptyDOMElement()
	})

	it.each([
		["published", ["Unpublish", "Deactivate"], ["Archive"]],
		["unpublished", ["Deactivate"], ["Unpublish", "Archive"]],
		["deactivated", ["Archive"], ["Unpublish", "Deactivate"]],
	] as const)("offers only the transitions legal from %s", (status, offered, withheld) => {
		render(
			<ContentLifecycleActions
				canPublish
				detail={detail({
					status,
					currentVersion: { ...detail().currentVersion, status },
				} as Partial<PisoCampContentReviewDetail>)}
			/>
		)

		for (const label of offered) {
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
		}
		for (const label of withheld) {
			expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument()
		}
		expect(screen.queryByLabelText("Scheduled publication")).not.toBeInTheDocument()
	})

	it("renders nothing at all for a draft item", () => {
		const { container } = render(
			<ContentLifecycleActions
				canPublish
				detail={detail({
					status: "draft",
					currentVersion: { ...detail().currentVersion, status: "draft" },
				} as Partial<PisoCampContentReviewDetail>)}
			/>
		)

		expect(container).toBeEmptyDOMElement()
	})

	it("confirms before withdrawing and sends the current version number", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUnpublish.mockReturnValue(mutation(mutate))
		render(<ContentLifecycleActions canPublish detail={detail()} />)

		await user.click(screen.getByRole("button", { name: "Unpublish" }))
		expect(await screen.findByText("Unpublish this content?")).toBeInTheDocument()
		expect(screen.getByText(/removed from the app at the next bundle build/i)).toBeInTheDocument()
		expect(mutate).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Confirm Unpublish" }))
		expect(mutate).toHaveBeenCalledTimes(1)
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			itemId: ITEM_ID,
			expectedVersionNo: 4,
			requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		})
	})

	it("says what deactivation means for end users before doing it", async () => {
		const user = userEvent.setup()
		render(<ContentLifecycleActions canPublish detail={detail()} />)

		await user.click(screen.getByRole("button", { name: "Deactivate" }))

		expect(
			await screen.findByText(/never presented to end users again .* trivia selection/i)
		).toBeInTheDocument()
	})

	it("announces success and keeps the announcement focusable", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onSuccess())
		useUnpublish.mockReturnValue(mutation(mutate))
		render(<ContentLifecycleActions canPublish detail={detail()} />)

		await user.click(screen.getByRole("button", { name: "Unpublish" }))
		await user.click(await screen.findByRole("button", { name: "Confirm Unpublish" }))

		const status = await screen.findByRole("status")
		expect(within(status).getByText("Lifecycle Updated")).toBeInTheDocument()
		expect(screen.getByText(/leaves the app at the next bundle build/i)).toBeInTheDocument()
	})

	it("focuses a conflict and asks the reader to reload", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onError({ status: 409 }))
		useDeactivate.mockReturnValue(mutation(mutate))
		render(<ContentLifecycleActions canPublish detail={detail()} />)

		await user.click(screen.getByRole("button", { name: "Deactivate" }))
		await user.click(await screen.findByRole("button", { name: "Confirm Deactivate" }))

		const alert = await screen.findByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(screen.getByText(/changed while you were reading/i)).toBeInTheDocument()
	})

	it("offers scheduling only on approved content and refuses a past time", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSchedule.mockReturnValue(mutation(mutate))
		render(
			<ContentLifecycleActions
				canPublish
				detail={detail({
					status: "approved",
					currentVersion: {
						...detail().currentVersion,
						status: "approved",
						transition: { action: "approve", comments: "Checked" },
						publication: null,
					},
				} as Partial<PisoCampContentReviewDetail>)}
			/>
		)

		const field = screen.getByLabelText("Scheduled publication")
		expect(field).toHaveAttribute("type", "datetime-local")
		await user.type(field, "2020-01-01T09:00")
		await user.click(screen.getByRole("button", { name: "Save Schedule" }))

		expect(mutate).not.toHaveBeenCalled()
		expect(await screen.findByText("Choose a time in the future.")).toBeInTheDocument()
	})

	it("saves a future schedule as a UTC instant and can clear it", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onSuccess())
		useSchedule.mockReturnValue(mutation(mutate))
		const future = new Date(Date.now() + 86_400_000)
		const localValue = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 16)

		render(
			<ContentLifecycleActions
				canPublish
				detail={detail({
					status: "approved",
					publishAt: null,
					currentVersion: {
						...detail().currentVersion,
						status: "approved",
						transition: { action: "approve", comments: "Checked" },
						publication: null,
					},
				} as Partial<PisoCampContentReviewDetail>)}
			/>
		)

		await user.type(screen.getByLabelText("Scheduled publication"), localValue)
		await user.click(screen.getByRole("button", { name: "Save Schedule" }))

		expect(mutate).toHaveBeenCalledTimes(1)
		const sent = mutate.mock.calls[0]?.[0] as { publishAt: string }
		expect(sent.publishAt.endsWith("Z")).toBe(true)
		expect(new Date(sent.publishAt).getTime()).toBeGreaterThan(Date.now())
		expect(screen.getByText(/publishes automatically at that time/i)).toBeInTheDocument()
	})

	it("clears an existing schedule and disables Clear when there is none", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onSuccess())
		useSchedule.mockReturnValue(mutation(mutate))
		const scheduled = detail({
			status: "approved",
			publishAt: "2099-01-01T00:00:00.000Z",
			currentVersion: {
				...detail().currentVersion,
				status: "approved",
				transition: { action: "approve", comments: "Checked" },
				publication: null,
			},
		} as Partial<PisoCampContentReviewDetail>)

		const { rerender } = render(<ContentLifecycleActions canPublish detail={scheduled} />)
		await user.click(screen.getByRole("button", { name: "Clear Schedule" }))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ publishAt: null }),
			expect.anything()
		)

		rerender(
			<ContentLifecycleActions
				canPublish
				detail={{ ...scheduled, publishAt: null } as PisoCampContentReviewDetail}
			/>
		)
		expect(screen.getByRole("button", { name: "Clear Schedule" })).toBeDisabled()
	})
})
