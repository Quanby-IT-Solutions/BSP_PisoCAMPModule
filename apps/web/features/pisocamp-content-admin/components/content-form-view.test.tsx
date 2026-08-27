import { useEffect, useState } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentFormView } from "./content-form-view"

const { useDetail, useCreate, useUpdate, useSubmit, push, toastSuccess } = vi.hoisted(() => ({
	useDetail: vi.fn(),
	useCreate: vi.fn(),
	useUpdate: vi.fn(),
	useSubmit: vi.fn(),
	push: vi.fn(),
	toastSuccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }))
vi.mock("@/features/pisocamp-content-admin/api/content.hooks", () => ({
	usePisoCampContentDetailQuery: (input: unknown, enabled: boolean) => useDetail(input, enabled),
	useCreatePisoCampContentMutation: () => useCreate(),
	useUpdatePisoCampContentMutation: () => useUpdate(),
	useSubmitPisoCampContentMutation: () => useSubmit(),
}))

const detail = {
	id: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
	contentType: "advisory",
	status: "draft",
	currentVersion: {
		id: "d7e9984f-fd54-49d9-bb33-0a7c006c83fd",
		versionNo: 3,
		status: "draft",
		content: {
			contentType: "advisory",
			title: "Existing advisory",
			summary: "Existing summary",
			body: "Existing body",
		},
		relatedLinks: [],
	},
	creator: { id: "creator", name: "Creator" },
	lastEditor: { id: "editor", name: "Editor" },
	createdAt: "2026-08-24T00:00:00.000Z",
	dateModified: "2026-08-25T00:00:00.000Z",
}

function mutation(mutate = vi.fn()) {
	return { mutate, reset: vi.fn(), isPending: false, isError: false, error: null }
}

function HistoryRouteHarness() {
	const [pathname, setPathname] = useState(window.location.pathname)

	useEffect(() => {
		const updateRoute = () => setPathname(window.location.pathname)
		window.addEventListener("popstate", updateRoute)
		return () => window.removeEventListener("popstate", updateRoute)
	}, [])

	return pathname === "/pisocamp/content/new" ? (
		<>
			<p>Editor route</p>
			<ContentFormView mode="create" />
		</>
	) : (
		<p>Dashboard route</p>
	)
}

async function chooseSelect(
	user: ReturnType<typeof userEvent.setup>,
	name: RegExp,
	option: string
) {
	const trigger = screen.getByRole("combobox", { name })
	expect(trigger).toHaveAttribute("data-slot", "select-trigger")
	await user.click(trigger)
	await user.click(await screen.findByRole("option", { name: option }))
}

describe("ContentFormView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useDetail.mockReturnValue({ isPending: false, isError: false, data: detail, refetch: vi.fn() })
		useCreate.mockReturnValue(mutation())
		useUpdate.mockReturnValue(mutation())
		useSubmit.mockReturnValue(mutation())
	})

	it("shows only fields applicable to each of the five content types", async () => {
		const user = userEvent.setup()
		render(<ContentFormView mode="create" />)
		await chooseSelect(user, /content type/i, "Banknote")
		expect(screen.getByLabelText(/currency series/i)).toBeInTheDocument()
		expect(screen.getByLabelText(/denomination/i)).toBeInTheDocument()
		expect(screen.queryByLabelText(/primary url/i)).not.toBeInTheDocument()

		await chooseSelect(user, /content type/i, "Coin")
		expect(screen.getByLabelText(/currency series/i)).toBeInTheDocument()

		await chooseSelect(user, /content type/i, "Security feature")
		expect(screen.getByLabelText(/currency series/i)).toBeInTheDocument()

		await chooseSelect(user, /content type/i, "Link")
		expect(screen.getByLabelText(/primary url/i)).toBeInTheDocument()
		expect(screen.queryByLabelText(/currency series/i)).not.toBeInTheDocument()

		await chooseSelect(user, /content type/i, "Advisory")
		expect(screen.queryByLabelText(/primary url/i)).not.toBeInTheDocument()
		expect(screen.queryByLabelText(/currency series/i)).not.toBeInTheDocument()
	})

	it("filters denominations and clears one invalid for a changed series", async () => {
		const user = userEvent.setup()
		render(<ContentFormView mode="create" />)
		await chooseSelect(user, /content type/i, "Security feature")
		await chooseSelect(user, /currency series/i, "New Generation Currency Banknotes")
		await chooseSelect(user, /denomination/i, "PHP 200")
		expect(screen.getByRole("combobox", { name: /denomination/i })).toHaveTextContent("PHP 200")
		await chooseSelect(user, /currency series/i, "First Philippine Polymer Banknote Series")
		const seriesTrigger = screen.getByRole("combobox", { name: /currency series/i })
		expect(seriesTrigger).toHaveAttribute("data-wrap-value", "true")
		expect(seriesTrigger).not.toHaveClass("data-[size=default]:h-8")
		expect(seriesTrigger).toHaveTextContent("First Philippine Polymer Banknote Series")
		expect(screen.getByRole("combobox", { name: /denomination/i })).toHaveTextContent(
			/Select a denomination/i
		)
	})

	it("adds, reorders, and removes labelled related links with buttons", async () => {
		const user = userEvent.setup()
		render(<ContentFormView mode="create" />)
		await user.click(screen.getByRole("button", { name: /add related link/i }))
		await user.click(screen.getByRole("button", { name: /add related link/i }))
		expect(screen.getAllByRole("group", { name: /related link \d/i })).toHaveLength(2)
		expect(screen.getByRole("group", { name: /^related links$/i })).toHaveClass(
			"w-full",
			"max-w-full",
			"p-[8px]",
			"sm:p-4"
		)
		for (const row of screen.getAllByRole("group", { name: /related link \d/i })) {
			expect(row).toHaveClass("w-full", "max-w-full", "p-[8px]", "sm:p-3")
		}
		const kindTriggers = screen.getAllByRole("combobox", { name: /link kind/i })
		expect(kindTriggers).toHaveLength(2)
		expect(kindTriggers[0]).toHaveAttribute("data-slot", "select-trigger")
		await user.click(kindTriggers[0]!)
		await user.click(await screen.findByRole("option", { name: "Internal route" }))
		expect(kindTriggers[0]).toHaveAttribute("data-wrap-value", "true")
		expect(kindTriggers[0]).not.toHaveClass("data-[size=default]:h-8")
		expect(kindTriggers[0]).toHaveTextContent("Internal route")
		expect(screen.getByLabelText("Internal route")).toHaveAttribute("spellcheck", "false")
		expect(screen.getByRole("button", { name: /move related link 2 up/i })).toBeEnabled()
		await user.click(screen.getByRole("button", { name: /move related link 2 up/i }))
		await user.click(screen.getByRole("button", { name: /remove related link 1/i }))
		expect(screen.getAllByLabelText(/link label/i)).toHaveLength(1)
		for (const action of [
			screen.getByRole("button", { name: /move related link 1 up/i }),
			screen.getByRole("button", { name: /move related link 1 down/i }),
			screen.getByRole("button", { name: /remove related link 1/i }),
			screen.getByRole("button", { name: /add related link/i }),
		]) {
			expect(action).toHaveClass("h-auto", "w-full", "whitespace-normal")
		}
	})

	it("focuses friendly conditional and nested related-link errors", async () => {
		const user = userEvent.setup()
		render(<ContentFormView mode="create" />)
		await user.type(screen.getByLabelText(/^title/i), "Banknote")
		await user.type(screen.getByLabelText(/^summary/i), "Summary")
		await user.type(screen.getByLabelText(/^body/i), "Body")
		await chooseSelect(user, /content type/i, "Banknote")
		await user.click(screen.getByRole("button", { name: /save draft/i }))

		const series = screen.getByRole("combobox", { name: /currency series/i })
		expect(series).toHaveFocus()
		expect(series).toHaveAttribute("aria-invalid", "true")
		expect(screen.getByText("Currency series is required.")).toHaveAttribute("role", "alert")

		await chooseSelect(user, /currency series/i, "New Generation Currency Banknotes")
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		const denomination = screen.getByRole("combobox", { name: /denomination/i })
		expect(denomination).toHaveFocus()
		expect(denomination).toHaveAttribute("aria-describedby", "denomination-code-error")

		await chooseSelect(user, /content type/i, "Link")
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		const primaryUrl = screen.getByLabelText(/primary url/i)
		expect(primaryUrl).toHaveFocus()
		expect(screen.getByText(/valid HTTPS URL/i)).toHaveAttribute("role", "alert")

		await user.type(primaryUrl, "https://www.bsp.gov.ph")
		await user.click(screen.getByRole("button", { name: /add related link/i }))
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		const linkLabel = screen.getByLabelText(/link label/i)
		expect(linkLabel).toHaveFocus()
		expect(linkLabel).toHaveAttribute("aria-invalid", "true")
		expect(linkLabel.getAttribute("aria-describedby")).toMatch(/link-label-.+-error/)
		expect(screen.getByText(/related link 1 label is required/i)).toHaveAttribute("role", "alert")

		await user.type(linkLabel, "BSP")
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		const linkUrl = screen.getByLabelText(/HTTPS URL/i)
		expect(linkUrl).toHaveFocus()
		expect(linkUrl).toHaveAttribute("type", "url")
		expect(screen.getByText(/related link 1.*HTTPS URL/i)).toHaveAttribute("role", "alert")
	})

	it("focuses the first invalid field and exposes understandable alerts", async () => {
		const user = userEvent.setup()
		render(<ContentFormView mode="create" />)
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		expect(screen.getByLabelText(/^title/i)).toHaveFocus()
		expect(screen.getByLabelText(/^title/i)).toHaveAttribute("aria-invalid", "true")
		expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/title is required/i)
	})

	it("announces create success, invalidates through the hook, and navigates", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, options) => options.onSuccess(detail))
		useCreate.mockReturnValue(mutation(mutate))
		render(<ContentFormView mode="create" />)
		await user.type(screen.getByLabelText(/^title/i), "Advisory")
		await user.type(screen.getByLabelText(/^summary/i), "Summary")
		await user.type(screen.getByLabelText(/^body/i), "Body")
		await user.click(screen.getByRole("button", { name: /save draft/i }))

		expect(mutate).toHaveBeenCalledTimes(1)
		expect(toastSuccess).toHaveBeenCalledWith("Draft saved.")
		expect(toastSuccess.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!)
		expect(push).toHaveBeenCalledWith("/pisocamp/content")
	})

	it("reuses the same request ID when a save is retried", async () => {
		const user = userEvent.setup()
		const mutate = vi
			.fn()
			.mockImplementationOnce((_input, options) => options.onError(new Error("offline")))
		useCreate.mockReturnValue(mutation(mutate))
		render(<ContentFormView mode="create" />)
		await user.type(screen.getByLabelText(/^title/i), "Advisory")
		await user.type(screen.getByLabelText(/^summary/i), "Summary")
		await user.type(screen.getByLabelText(/^body/i), "Body")

		await user.click(screen.getByRole("button", { name: /save draft/i }))
		await user.click(screen.getByRole("button", { name: /save draft/i }))

		expect(mutate).toHaveBeenCalledTimes(2)
		expect(mutate.mock.calls[0]?.[0].requestId).toBe(mutate.mock.calls[1]?.[0].requestId)
	})

	it("submits a successful edit with the loaded version and navigates", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, options) => options.onSuccess(detail))
		useUpdate.mockReturnValue(mutation(mutate))
		render(<ContentFormView mode="edit" itemId={detail.id} />)

		await user.click(screen.getByRole("button", { name: /save draft/i }))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: detail.id, expectedVersionNo: 3 }),
			expect.any(Object)
		)
		expect(toastSuccess).toHaveBeenCalledWith("Draft saved.")
		expect(push).toHaveBeenCalledWith("/pisocamp/content")
	})

	it("confirms submission of the saved draft and blocks a synchronous double submit", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSubmit.mockReturnValue(mutation(mutate))
		render(<ContentFormView mode="edit" itemId={detail.id} canSubmit />)

		await user.click(screen.getByRole("button", { name: /submit for review/i }))
		expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Submit Draft for Review?")
		expect(screen.getByRole("button", { name: /^cancel$/i })).toHaveClass("min-h-11")
		const confirm = screen.getByRole("button", { name: /confirm submission/i })
		act(() => {
			confirm.click()
			confirm.click()
		})

		expect(mutate).toHaveBeenCalledTimes(1)
		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ itemId: detail.id, expectedVersionNo: 3 }),
			expect.any(Object)
		)
		expect(screen.getByRole("status")).toHaveTextContent("Submitting draft for review…")
		await waitFor(() => expect(confirm).toBeDisabled())
	})

	it("closes a failed submit dialog, focuses safe error copy, and permits retry", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, options) => options.onError(new Error("private upstream detail")))
		useSubmit.mockReturnValue(mutation(mutate))
		render(<ContentFormView mode="edit" itemId={detail.id} canSubmit />)

		await user.click(screen.getByRole("button", { name: /submit for review/i }))
		await user.click(screen.getByRole("button", { name: /confirm submission/i }))

		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(screen.getByText("Submission Not Completed")).toBeInTheDocument()
		expect(alert).toHaveTextContent(/check your connection.*try submitting/is)
		expect(alert).not.toHaveTextContent(/private upstream detail/i)
		await user.click(screen.getByRole("button", { name: /submit for review/i }))
		expect(screen.getByRole("alertdialog")).toBeInTheDocument()
	})

	it("withholds submission for unsaved edits and renders non-draft content read-only", async () => {
		const user = userEvent.setup()
		const { rerender } = render(<ContentFormView mode="edit" itemId={detail.id} canSubmit />)
		const submit = screen.getByRole("button", { name: /submit for review/i })
		expect(submit).toBeEnabled()
		await user.type(screen.getByLabelText(/^title/i), " changed")
		expect(submit).toBeDisabled()
		expect(screen.getByText(/save your changes before submitting/i)).toBeInTheDocument()

		useDetail.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				...detail,
				status: "submitted_for_review",
				currentVersion: { ...detail.currentVersion, status: "submitted_for_review" },
			},
			refetch: vi.fn(),
		})
		rerender(<ContentFormView mode="edit" itemId={detail.id} canSubmit />)
		expect(screen.getByRole("heading", { name: "Editing Unavailable" })).toBeInTheDocument()
		expect(screen.getByText("This Content Is Read-Only")).toBeInTheDocument()
		expect(screen.getByText("Submitted for review")).toBeInTheDocument()
		expect(screen.queryByRole("form")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument()
	})

	it("submits immutable edit version data and shows a 409 reload action without overwriting", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn().mockResolvedValue({ data: detail, status: "success", isError: false })
		useDetail.mockReturnValue({ isPending: false, isError: false, data: detail, refetch })
		let isError = false
		const reset = vi.fn(() => {
			isError = false
		})
		const mutate = vi.fn((_input, options) => {
			isError = true
			options.onError({ status: 409, code: "CONFLICT" })
		})
		useUpdate.mockImplementation(() => ({
			mutate,
			reset,
			isPending: false,
			isError,
			error: isError ? { status: 409, code: "CONFLICT" } : null,
		}))
		render(<ContentFormView mode="edit" itemId={detail.id} />)
		const title = screen.getByLabelText(/^title/i)
		await user.clear(title)
		await user.type(title, "My unsaved edit")
		await user.click(screen.getByRole("button", { name: /save draft/i }))

		expect(mutate.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ itemId: detail.id, expectedVersionNo: 3 })
		)
		expect(screen.getByRole("alert")).toHaveTextContent(/newer version/i)
		expect(screen.getByText("A Newer Version Is Available")).toBeInTheDocument()
		expect(screen.queryByText(/could not save draft/i)).not.toBeInTheDocument()
		expect(title).toHaveValue("My unsaved edit")
		await user.click(screen.getByRole("button", { name: /reload latest/i }))
		expect(refetch).toHaveBeenCalledTimes(1)
		expect(reset).toHaveBeenCalledTimes(1)
		expect(screen.queryByText(/could not save draft/i)).not.toBeInTheDocument()
	})

	it("keeps a conflict and unsaved values when Reload Latest receives stale error data", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn().mockResolvedValue({
			data: detail,
			status: "error",
			isError: true,
			error: new Error("offline"),
		})
		useDetail.mockReturnValue({ isPending: false, isError: false, data: detail, refetch })
		const reset = vi.fn()
		const mutate = vi.fn((_input, options) => options.onError({ status: 409, code: "CONFLICT" }))
		useUpdate.mockReturnValue({ ...mutation(mutate), reset })
		render(<ContentFormView mode="edit" itemId={detail.id} />)

		const title = screen.getByLabelText(/^title/i)
		await user.clear(title)
		await user.type(title, "Unsaved title")
		await user.click(screen.getByRole("button", { name: /save draft/i }))
		await user.click(screen.getByRole("button", { name: /reload latest/i }))

		expect(reset).toHaveBeenCalledTimes(1)
		expect(refetch).toHaveBeenCalledTimes(1)
		expect(title).toHaveValue("Unsaved title")
		expect(screen.getByRole("alert")).toHaveTextContent(/newer version.*not been overwritten/is)
		expect(screen.getByRole("button", { name: /reload latest/i })).toBeInTheDocument()
		expect(push).not.toHaveBeenCalled()
	})

	it("confirms dirty cancellation and reload, and disables double submit while saving", async () => {
		const user = userEvent.setup()
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		useCreate.mockReturnValue({ ...mutation(), isPending: true })
		render(<ContentFormView mode="create" />)
		await user.type(screen.getByLabelText(/^title/i), "Dirty")
		await user.click(screen.getByRole("button", { name: /cancel/i }))
		expect(confirm).toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
		expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled()

		const event = new Event("beforeunload", { cancelable: true })
		window.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(true)
	})

	it("guards dirty links and keeps router-observable editor state on cancelled Back", async () => {
		const user = userEvent.setup()
		window.history.replaceState({}, "", "/dashboard")
		window.history.pushState({}, "", "/pisocamp/content/new")
		const historyLengthBeforeDirty = window.history.length
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		render(
			<>
				<a href="/dashboard">Dashboard</a>
				<HistoryRouteHarness />
			</>
		)
		await user.type(screen.getByLabelText(/^title/i), "Dirty")
		await waitFor(() => expect(window.history.length).toBe(historyLengthBeforeDirty + 1))

		const anchorClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
		screen.getByRole("link", { name: "Dashboard" }).dispatchEvent(anchorClick)
		expect(anchorClick.defaultPrevented).toBe(true)

		window.history.back()
		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
		expect(window.location.pathname).toBe("/pisocamp/content/new")
		expect(screen.getByText("Editor route")).toBeInTheDocument()
		expect(screen.getByLabelText(/^title/i)).toHaveValue("Dirty")

		confirm.mockReturnValue(true)
		window.history.back()
		await waitFor(() => expect(window.location.pathname).toBe("/dashboard"))
		expect(screen.getByText("Dashboard route")).toBeInTheDocument()
		expect(screen.queryByText("Editor route")).not.toBeInTheDocument()
	})

	it("reconciles a stale sentinel on clean remount before Back or a new dirty session", async () => {
		const user = userEvent.setup()
		window.history.replaceState({}, "", "/dashboard")
		window.history.pushState({}, "", "/pisocamp/content/new")
		const historyLengthBeforeDirty = window.history.length
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		const firstMount = render(<HistoryRouteHarness />)

		await user.type(screen.getByLabelText(/^title/i), "Dirty before reload")
		await waitFor(() =>
			expect(window.history.state).toHaveProperty("__pisoCampContentDirtyGuard", true)
		)
		expect(window.history.length).toBe(historyLengthBeforeDirty + 1)

		firstMount.unmount()
		render(<HistoryRouteHarness />)
		expect(screen.getByText("Editor route")).toBeInTheDocument()
		await waitFor(() =>
			expect(window.history.state).not.toHaveProperty("__pisoCampContentDirtyGuard")
		)
		expect(screen.getByText("Editor route")).toBeInTheDocument()
		expect(window.location.pathname).toBe("/pisocamp/content/new")
		expect(window.history.length).toBe(historyLengthBeforeDirty + 1)
		expect(confirm).not.toHaveBeenCalled()

		window.history.back()
		await waitFor(() => expect(window.location.pathname).toBe("/dashboard"))
		expect(screen.getByText("Dashboard route")).toBeInTheDocument()

		window.history.forward()
		await waitFor(() => expect(screen.getByText("Editor route")).toBeInTheDocument())
		window.history.forward()
		await waitFor(() =>
			expect(window.history.state).not.toHaveProperty("__pisoCampContentDirtyGuard")
		)
		expect(screen.getByText("Editor route")).toBeInTheDocument()
		expect(confirm).not.toHaveBeenCalled()

		await user.type(screen.getByLabelText(/^title/i), "Dirty again")
		await waitFor(() =>
			expect(window.history.state).toHaveProperty("__pisoCampContentDirtyGuard", true)
		)
		expect(window.history.length).toBe(historyLengthBeforeDirty + 1)
		window.history.back()
		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
		expect(window.location.pathname).toBe("/pisocamp/content/new")
		expect(screen.getByText("Editor route")).toBeInTheDocument()
	})

	it("provides loading/error edit states and a narrow 200%-text reflow boundary", async () => {
		const user = userEvent.setup()
		useDetail.mockReturnValueOnce({ isPending: true, isError: false, data: undefined })
		const { rerender } = render(<ContentFormView mode="edit" itemId={detail.id} />)
		expect(screen.getByRole("status", { name: /loading content/i })).toBeInTheDocument()

		const refetch = vi.fn()
		useDetail.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		rerender(<ContentFormView mode="edit" itemId={detail.id} />)
		await user.click(screen.getByRole("button", { name: /try again/i }))
		expect(screen.getByRole("button", { name: /try again/i })).toHaveClass("min-h-11")
		expect(refetch).toHaveBeenCalled()

		useDetail.mockReturnValue({ isPending: false, isError: false, data: detail, refetch })
		rerender(<ContentFormView mode="edit" itemId={detail.id} />)
		const layout = screen.getByTestId("content-form-layout")
		expect(layout).toHaveClass("w-full", "min-w-0", "max-w-full")
		expect(layout).not.toHaveClass("overflow-x-hidden", "overflow-hidden")
		const heading = screen.getByRole("heading", { name: "Edit Content" })
		expect(heading).toHaveClass("whitespace-normal", "break-words", "text-pretty")
		expect(heading).not.toHaveClass("truncate")
		expect(screen.getByRole("heading", { level: 2, name: "Draft Details" })).toBeInTheDocument()
		const card = layout.querySelector('[data-slot="card"]')
		expect(card).toHaveClass("w-full", "min-w-0", "max-w-4xl", "overflow-visible")
		expect(card).not.toHaveClass("overflow-hidden")
		expect(layout.querySelector('[data-slot="card-header"]')).toHaveClass("px-[8px]", "sm:px-4")
		expect(layout.querySelector('[data-slot="card-content"]')).toHaveClass("px-[8px]", "sm:px-4")
		for (const control of screen.getAllByRole("combobox")) {
			expect(control).toHaveClass("h-auto", "w-full", "min-w-0", "max-w-full", "whitespace-normal")
			expect(control).toHaveAttribute("data-wrap-value", "true")
			expect(control).not.toHaveClass("data-[size=default]:h-8")
		}
	})
})
