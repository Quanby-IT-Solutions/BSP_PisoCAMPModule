import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentReviewView } from "./content-review-view"

const {
	useReview,
	useApprove,
	useReject,
	usePublish,
	useUnpublish,
	useDeactivate,
	useArchive,
	useSchedule,
	toastSuccess,
} = vi.hoisted(() => ({
	useReview: vi.fn(),
	useApprove: vi.fn(),
	useReject: vi.fn(),
	usePublish: vi.fn(),
	useUnpublish: vi.fn(),
	useDeactivate: vi.fn(),
	useArchive: vi.fn(),
	useSchedule: vi.fn(),
	toastSuccess: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: toastSuccess } }))
vi.mock("@/features/pisocamp-content-admin/api/content.hooks", () => ({
	usePisoCampContentReviewDetailQuery: (input: unknown) => useReview(input),
	useApprovePisoCampContentMutation: () => useApprove(),
	useRejectPisoCampContentMutation: () => useReject(),
	usePublishPisoCampContentMutation: () => usePublish(),
	useUnpublishPisoCampContentMutation: () => useUnpublish(),
	useDeactivatePisoCampContentMutation: () => useDeactivate(),
	useArchivePisoCampContentMutation: () => useArchive(),
	useSchedulePisoCampContentPublicationMutation: () => useSchedule(),
}))

const detail = {
	id: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
	contentType: "banknote",
	status: "submitted_for_review",
	publishAt: null,
	currentVersion: {
		id: "d7e9984f-fd54-49d9-bb33-0a7c006c83fd",
		versionNo: 4,
		status: "submitted_for_review",
		content: {
			contentType: "banknote",
			title: "PHP 100 banknote",
			summary: "Recognize the current PHP 100 banknote.",
			body: "Inspect the portrait, security thread, watermark, and tactile marks.",
			seriesCode: "ngc-banknotes",
			denominationCode: "php-100",
		},
		relatedLinks: [
			{
				id: "2f08ac0e-8a78-4cee-b37c-88e2d63d8f8f",
				position: 0,
				kind: "external",
				label: "BSP banknotes",
				url: "https://www.bsp.gov.ph/Pages/CoinsAndNotes/Banknotes.aspx",
			},
		],
		createdBy: { id: "editor", name: "Elena Editor" },
		createdAt: "2026-08-26T08:00:00.000Z",
		transition: { action: "submit", comments: "Ready for review." },
		approval: null,
		publication: null,
	},
	creator: { id: "creator", name: "Maria Creator" },
	lastEditor: { id: "editor", name: "Elena Editor" },
	createdAt: "2026-08-25T08:00:00.000Z",
	dateModified: "2026-08-26T08:00:00.000Z",
}

function mutation(mutate = vi.fn()) {
	return { mutate, reset: vi.fn(), isPending: false, isError: false, error: null }
}

describe("ContentReviewView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useReview.mockReturnValue({ isPending: false, isError: false, data: detail, refetch: vi.fn() })
		useApprove.mockReturnValue(mutation())
		useReject.mockReturnValue(mutation())
		usePublish.mockReturnValue(mutation())
		useUnpublish.mockReturnValue(mutation())
		useDeactivate.mockReturnValue(mutation())
		useArchive.mockReturnValue(mutation())
		useSchedule.mockReturnValue(mutation())
	})

	it("renders loading and focused error/retry states", async () => {
		const user = userEvent.setup()
		useReview.mockReturnValueOnce({ isPending: true, isError: false, data: undefined })
		const { rerender } = render(
			<ContentReviewView itemId={detail.id} canApprove canPublish={false} />
		)
		expect(screen.getByRole("status", { name: /loading review details/i })).toBeInTheDocument()

		const refetch = vi.fn()
		useReview.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		rerender(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)
		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(screen.getByText("Could Not Load Review Details")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /try again/i }))
		expect(refetch).toHaveBeenCalledOnce()
	})

	it("renders the complete immutable snapshot and workflow metadata without color-only meaning", () => {
		render(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)

		expect(
			screen.getByRole("heading", { level: 1, name: detail.currentVersion.content.title })
		).toBeInTheDocument()
		expect(screen.getByText(detail.currentVersion.content.summary)).toBeInTheDocument()
		expect(screen.getByText(detail.currentVersion.content.body)).toBeInTheDocument()
		expect(screen.getByText("ngc-banknotes")).toBeInTheDocument()
		expect(screen.getByText("php-100")).toBeInTheDocument()
		expect(screen.getByText("ngc-banknotes")).toHaveAttribute("translate", "no")
		expect(screen.getByText("php-100")).toHaveAttribute("translate", "no")
		expect(screen.getByText("Banknote")).toBeInTheDocument()
		expect(screen.getByText(/Aug 25, 2026/i)).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "BSP banknotes" })).toHaveAttribute(
			"href",
			detail.currentVersion.relatedLinks[0]!.url
		)
		expect(screen.getByRole("link", { name: "BSP banknotes" })).toHaveClass("hover:text-primary/80")
		expect(screen.getByText("Submitted for review")).toBeInTheDocument()
		expect(screen.getAllByText("Elena Editor").length).toBeGreaterThan(0)
		expect(screen.getByText("Maria Creator")).toBeInTheDocument()
		expect(screen.getAllByText(/Aug 26, 2026/i).length).toBeGreaterThan(0)
		expect(screen.getAllByText(/Asia\/Manila/i).length).toBeGreaterThan(0)
		expect(screen.getByText("Ready for review.")).toBeInTheDocument()
		const layout = screen.getByTestId("content-review-layout")
		expect(layout).toHaveClass("w-full", "max-w-full", "min-w-0")
		expect(layout).not.toHaveClass("overflow-hidden", "overflow-x-hidden")
		expect(
			screen.getByRole("heading", { level: 2, name: /immutable snapshot/i })
		).toBeInTheDocument()
	})

	it("enforces contract-aligned plain text and accepts punctuation for approve/reject", async () => {
		const user = userEvent.setup()
		const approve = vi.fn(
			(_input: unknown, options: { onSuccess: (result: typeof detail) => void }) =>
				options.onSuccess(detail)
		)
		const reject = vi.fn(
			(_input: unknown, options: { onSuccess: (result: typeof detail) => void }) =>
				options.onSuccess(detail)
		)
		useApprove.mockReturnValue(mutation(approve))
		useReject.mockReturnValue(mutation(reject))
		render(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)

		const approveButton = screen.getByRole("button", { name: /^approve$/i })
		approveButton.focus()
		await user.keyboard("{Enter}")
		const comments = screen.getByLabelText(/review comments/i)
		expect(comments).toHaveFocus()
		expect(comments).toHaveAttribute("autocomplete", "off")
		expect(comments).toHaveAttribute("aria-invalid", "true")
		expect(screen.getByRole("alert")).toHaveTextContent(/comments are required/i)
		expect(approve).not.toHaveBeenCalled()

		await user.type(comments, "<b>Approved</b>")
		await user.click(approveButton)
		expect(comments).toHaveFocus()
		expect(screen.getByRole("alert")).toHaveTextContent(/plain text.*HTML/i)
		expect(approve).not.toHaveBeenCalled()

		await user.clear(comments)
		await user.type(comments, "Verified — BSP's “100-piso” note (2026).")
		await user.click(approveButton)
		expect(approve).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: detail.id,
				expectedVersionNo: 4,
				comments: "Verified — BSP's “100-piso” note (2026).",
			}),
			expect.any(Object)
		)

		await user.clear(comments)
		await user.type(comments, "<!-- reject -->")
		await user.click(screen.getByRole("button", { name: /^reject$/i }))
		expect(comments).toHaveFocus()
		expect(reject).not.toHaveBeenCalled()

		await user.clear(comments)
		await user.type(comments, "Please correct §2: security-feature description (v2.1).")
		await user.click(screen.getByRole("button", { name: /^reject$/i }))
		expect(reject).toHaveBeenCalledWith(
			expect.objectContaining({
				comments: "Please correct §2: security-feature description (v2.1).",
			}),
			expect.any(Object)
		)
	})

	it("announces a polite pending workflow status", async () => {
		const user = userEvent.setup()
		useApprove.mockReturnValue(mutation(vi.fn()))
		render(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)
		await user.type(screen.getByLabelText(/review comments/i), "Reviewed — valid punctuation.")
		await user.click(screen.getByRole("button", { name: /^approve$/i }))

		const pending = screen.getByRole("status")
		expect(pending).toHaveAttribute("aria-live", "polite")
		expect(pending).toHaveTextContent("Approving content…")
	})

	it("shows only state- and permission-appropriate controls and confirms one publication", async () => {
		const user = userEvent.setup()
		const publish = vi.fn()
		usePublish.mockReturnValue(mutation(publish))
		const approved = {
			...detail,
			status: "approved",
			currentVersion: {
				...detail.currentVersion,
				status: "approved",
				transition: { action: "approve", comments: "Approved copy." },
				approval: {
					actor: { id: "approver", name: "Ana Approver" },
					at: "2026-08-26T09:00:00.000Z",
				},
			},
		}
		useReview.mockReturnValue({
			isPending: false,
			isError: false,
			data: approved,
			refetch: vi.fn(),
		})
		const { rerender } = render(
			<ContentReviewView itemId={detail.id} canApprove canPublish={false} />
		)
		expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()

		rerender(<ContentReviewView itemId={detail.id} canApprove canPublish />)
		await user.click(screen.getByRole("button", { name: /publish approved version/i }))
		const dialog = screen.getByRole("alertdialog")
		expect(dialog).toHaveAccessibleName("Publish Approved Content?")
		expect(dialog).toHaveClass("overscroll-contain")
		expect(screen.getByRole("button", { name: /^cancel$/i })).toHaveClass("min-h-11")
		const confirm = screen.getByRole("button", { name: /confirm publication/i })
		confirm.click()
		confirm.click()
		expect(publish).toHaveBeenCalledTimes(1)
		expect(publish).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: detail.id, expectedVersionNo: 4 }),
			expect.any(Object)
		)
		await waitFor(() => expect(confirm).toBeDisabled())
	})

	it("closes a failed publish dialog, focuses safe error copy, and permits retry", async () => {
		const user = userEvent.setup()
		const approved = {
			...detail,
			status: "approved",
			currentVersion: {
				...detail.currentVersion,
				status: "approved",
				transition: { action: "approve", comments: "Approved copy." },
				approval: {
					actor: { id: "approver", name: "Ana Approver" },
					at: "2026-08-26T09:00:00.000Z",
				},
			},
		}
		useReview.mockReturnValue({
			isPending: false,
			isError: false,
			data: approved,
			refetch: vi.fn(),
		})
		usePublish.mockReturnValue(
			mutation(vi.fn((_input, options) => options.onError(new Error("private publish detail"))))
		)
		render(<ContentReviewView itemId={detail.id} canApprove canPublish />)

		await user.click(screen.getByRole("button", { name: /publish approved version/i }))
		await user.click(screen.getByRole("button", { name: /confirm publication/i }))

		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(alert).toHaveTextContent(/check your connection.*try again/is)
		expect(alert).not.toHaveTextContent(/private publish detail/i)
		await user.click(screen.getByRole("button", { name: /publish approved version/i }))
		expect(screen.getByRole("alertdialog")).toBeInTheDocument()
	})

	it("focuses stale conflicts and generic errors, reloads latest, and announces success", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useReview.mockReturnValue({ isPending: false, isError: false, data: detail, refetch })
		const approve = vi
			.fn()
			.mockImplementationOnce((_input, options) =>
				options.onError({ status: 409, code: "CONFLICT" })
			)
			.mockImplementationOnce((_input, options) => options.onError(new Error("private failure")))
			.mockImplementationOnce((_input, options) => options.onSuccess(detail))
		useApprove.mockReturnValue(mutation(approve))
		render(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)
		const comments = screen.getByLabelText(/review comments/i)
		await user.type(comments, "Reviewed and verified.")

		await user.click(screen.getByRole("button", { name: /^approve$/i }))
		let alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(alert).toHaveTextContent(/newer version/i)
		await user.click(screen.getByRole("button", { name: /reload latest/i }))
		expect(refetch).toHaveBeenCalledOnce()

		await user.click(screen.getByRole("button", { name: /^approve$/i }))
		alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(screen.getByText("Action Not Completed")).toBeInTheDocument()
		expect(alert).toHaveTextContent(/could not complete/i)
		expect(alert).not.toHaveTextContent(/private failure/i)

		await user.click(screen.getByRole("button", { name: /^approve$/i }))
		const status = screen.getByRole("status")
		await waitFor(() => expect(status).toHaveFocus())
		expect(status).toHaveTextContent(/content approved/i)
		expect(toastSuccess).toHaveBeenCalledWith("Content approved.")
	})

	it("offers a preview link for the current version only to a preview-permission holder", () => {
		const { rerender } = render(
			<ContentReviewView itemId={detail.id} canApprove canPreview canPublish={false} />
		)

		expect(screen.getByRole("link", { name: "Preview Version 4" })).toHaveAttribute(
			"href",
			`/pisocamp/content/${detail.id}/versions/4/preview`
		)

		rerender(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)
		expect(screen.queryByRole("link", { name: /Preview Version/ })).not.toBeInTheDocument()
	})

	it("hides the preview link once the version is published", () => {
		useReview.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...detail, status: "published" },
			refetch: vi.fn(),
		})

		render(<ContentReviewView itemId={detail.id} canApprove canPreview canPublish />)

		expect(screen.queryByRole("link", { name: /Preview Version/ })).not.toBeInTheDocument()
	})

	it("links to version history only for a restore-permission holder", () => {
		const { rerender } = render(
			<ContentReviewView itemId={detail.id} canApprove canRestore canPublish={false} />
		)

		expect(screen.getByRole("link", { name: "View Version History" })).toHaveAttribute(
			"href",
			`/pisocamp/content/${detail.id}/versions`
		)

		rerender(<ContentReviewView itemId={detail.id} canApprove canPublish={false} />)
		expect(screen.queryByRole("link", { name: "View Version History" })).not.toBeInTheDocument()
	})
})
