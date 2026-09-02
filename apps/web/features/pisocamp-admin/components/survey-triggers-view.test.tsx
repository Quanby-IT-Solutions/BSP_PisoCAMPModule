import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SurveyTriggersView } from "./survey-triggers-view"

const { useList, useUpsert, useRemove } = vi.hoisted(() => ({
	useList: vi.fn(),
	useUpsert: vi.fn(),
	useRemove: vi.fn(),
}))

vi.mock("@/features/pisocamp-admin/api/survey-triggers.hooks", () => ({
	usePisoCampSurveyTriggersQuery: () => useList(),
	useUpsertPisoCampSurveyTriggerMutation: () => useUpsert(),
	useDeletePisoCampSurveyTriggerMutation: () => useRemove(),
}))

const SURVEY_ID = "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61"

function mutation(mutate = vi.fn()) {
	return { mutate, isPending: false }
}

const rule = {
	id: "aa11bb22-cc33-4d44-8e55-ff6677889900",
	contentItemId: SURVEY_ID,
	surveyTitle: "How did we do?",
	triggerType: "topic_completion" as const,
	pageDepth: null,
	frequencyCapDays: 30,
	priority: 10,
	enabled: true,
	updatedAt: "2026-09-02T04:05:06.000Z",
}

describe("SurveyTriggersView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { rules: [rule] },
			refetch: vi.fn(),
		})
		useUpsert.mockReturnValue(mutation())
		useRemove.mockReturnValue(mutation())
	})

	it("shows each rule with its trigger, cap and priority", () => {
		render(<SurveyTriggersView />)

		// The table, not the form: the trigger select shows the same words.
		const row = screen.getByRole("row", { name: /how did we do\?/i })
		expect(row).toHaveTextContent("Topic completion")
		expect(row).toHaveTextContent("Once per 30 days")
		expect(row).toHaveTextContent("10")
	})

	it("says plainly when a rule has no cap", () => {
		useList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { rules: [{ ...rule, frequencyCapDays: null }] },
			refetch: vi.fn(),
		})

		render(<SurveyTriggersView />)

		expect(screen.getByText("Every time")).toBeInTheDocument()
	})

	it("says nothing is offered until a rule exists", () => {
		useList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { rules: [] },
			refetch: vi.fn(),
		})

		render(<SurveyTriggersView />)

		expect(screen.getByText("No survey triggers yet")).toBeInTheDocument()
	})

	it("saves a rule with its cap and priority", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpsert.mockReturnValue(mutation(mutate))
		render(<SurveyTriggersView />)

		await user.type(screen.getByLabelText(/survey content id/i), SURVEY_ID)
		await user.clear(screen.getByLabelText(/frequency cap/i))
		await user.type(screen.getByLabelText(/frequency cap/i), "7")
		await user.clear(screen.getByLabelText(/^priority/i))
		await user.type(screen.getByLabelText(/^priority/i), "1")
		await user.click(screen.getByRole("button", { name: /save rule/i }))

		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			contentItemId: SURVEY_ID,
			triggerType: "topic_completion",
			pageDepth: null,
			frequencyCapDays: 7,
			priority: 1,
			enabled: true,
		})
	})

	it("asks for a depth only for a page-depth trigger, and sends it", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpsert.mockReturnValue(mutation(mutate))
		render(<SurveyTriggersView />)

		expect(screen.queryByLabelText(/page depth/i)).not.toBeInTheDocument()

		await user.click(screen.getByRole("combobox", { name: /trigger/i }))
		await user.click(await screen.findByRole("option", { name: "Page depth" }))
		await user.type(screen.getByLabelText(/survey content id/i), SURVEY_ID)
		await user.type(screen.getByLabelText(/page depth/i), "5")
		await user.click(screen.getByRole("button", { name: /save rule/i }))

		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			triggerType: "page_depth",
			pageDepth: 5,
		})
	})

	it("refuses a page-depth rule with no depth, and says why", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpsert.mockReturnValue(mutation(mutate))
		render(<SurveyTriggersView />)

		await user.click(screen.getByRole("combobox", { name: /trigger/i }))
		await user.click(await screen.findByRole("option", { name: "Page depth" }))
		await user.type(screen.getByLabelText(/survey content id/i), SURVEY_ID)
		await user.click(screen.getByRole("button", { name: /save rule/i }))

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByRole("alert")).toHaveTextContent(
			"A page-depth trigger needs a depth."
		)
	})

	it("sends no cap when the field is left blank", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpsert.mockReturnValue(mutation(mutate))
		render(<SurveyTriggersView />)

		await user.type(screen.getByLabelText(/survey content id/i), SURVEY_ID)
		await user.clear(screen.getByLabelText(/frequency cap/i))
		await user.click(screen.getByRole("button", { name: /save rule/i }))

		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		// Blank means "every time", not "every zero days".
		expect(mutate.mock.calls[0]?.[0].frequencyCapDays).toBeNull()
	})

	it("removes a rule by its survey and trigger", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useRemove.mockReturnValue(mutation(mutate))
		render(<SurveyTriggersView />)

		await user.click(
			screen.getByRole("button", { name: /remove how did we do\? topic completion rule/i })
		)

		await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			contentItemId: SURVEY_ID,
			triggerType: "topic_completion",
		})
	})

	it("offers a way back when the rules could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useList.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<SurveyTriggersView />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
