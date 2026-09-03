import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ModuleConfigurationView } from "./module-configuration-view"

const useConfigQuery = vi.fn()
const useUpdateConfig = vi.fn()

vi.mock("@/features/pisocamp-admin/api/pisocamp-config.hooks", () => ({
	usePisoCampAdminConfigQuery: () => useConfigQuery(),
	useUpdatePisoCampAdminConfigMutation: () => useUpdateConfig(),
}))

describe("ModuleConfigurationView", () => {
	beforeEach(() => {
		useConfigQuery.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				session_inactivity_minutes: 30,
				exit_advisory_interval_hours: 24,
				churn_inactivity_days: 30,
				trivia_repeat_days: 30,
				leaderboard_enabled: false,
				key_action_events: ["content_view", "feature_use"],
				age_group_buckets: [
					{ minAge: 0, maxAge: 17 },
					{ minAge: 18, maxAge: null },
				],
				suppression_minimum: 10,
				recognition_confidence_threshold: 0.8,
				active_privacy_notice_version: "2024-12-26",
			},
			refetch: vi.fn(),
		})
		useUpdateConfig.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
		})
	})

	it("shows an accessible loading state", () => {
		useConfigQuery.mockReturnValue({ isPending: true, isError: false, data: undefined })
		render(<ModuleConfigurationView />)

		expect(screen.getByRole("status", { name: /loading configuration/i })).toBeInTheDocument()
	})

	it("shows a recoverable fetch error without internals", () => {
		useConfigQuery.mockReturnValue({
			isPending: false,
			isError: true,
			data: undefined,
			refetch: vi.fn(),
		})
		render(<ModuleConfigurationView />)

		expect(screen.getByRole("alert")).toHaveTextContent(/could not load module configuration/i)
		expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
	})

	it("renders the loaded form without role or audit management controls", () => {
		render(<ModuleConfigurationView />)

		expect(screen.getByRole("spinbutton", { name: /session inactivity/i })).toHaveValue(30)
		expect(screen.queryByText(/role management/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/audit log/i)).not.toBeInTheDocument()
	})

	it("associates client validation with the input", async () => {
		const user = userEvent.setup()
		render(<ModuleConfigurationView />)
		const input = screen.getByRole("spinbutton", { name: /session inactivity/i })

		await user.clear(input)
		await user.type(input, "0")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(input).toHaveAttribute("aria-invalid", "true")
		expect(input).toHaveFocus()
		expect(input).toHaveAttribute("name", "session_inactivity_minutes")
		expect(input).toHaveAttribute("autocomplete", "off")
		const errorId = input.getAttribute("aria-describedby")
		expect(errorId).toBeTruthy()
		const error = document.getElementById(errorId!)
		expect(error).toHaveTextContent(/between 1 and 1,440/i)
		expect(error).toHaveAttribute("role", "alert")
	})

	it("submits with the keyboard", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)
		const input = screen.getByRole("spinbutton", { name: /session inactivity/i })

		await user.clear(input)
		await user.type(input, "45{Enter}")

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ session_inactivity_minutes: 45 }),
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
	})

	it("disables saving while the update is pending", () => {
		useUpdateConfig.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
		render(<ModuleConfigurationView />)

		expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled()
	})

	it("announces successful and failed saves", async () => {
		const user = userEvent.setup()
		useUpdateConfig.mockReturnValue({
			mutate: vi.fn((_input, options) => options.onSuccess()),
			isPending: false,
			isError: false,
		})
		const { rerender } = render(<ModuleConfigurationView />)
		await user.click(screen.getByRole("button", { name: /save configuration/i }))
		expect(screen.getByRole("status")).toHaveTextContent(/configuration saved/i)

		useUpdateConfig.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: true,
			error: new Error("secret detail"),
		})
		rerender(<ModuleConfigurationView />)
		expect(screen.getByRole("alert")).toHaveTextContent(/could not save configuration/i)
		expect(screen.getByRole("alert")).not.toHaveTextContent(/secret detail/i)
	})

	it("saves the exit advisory interval alongside the session setting", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const interval = screen.getByLabelText(/exit advisory interval/i)
		await user.clear(interval)
		await user.type(interval, "6")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate).toHaveBeenCalledTimes(1)
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			session_inactivity_minutes: 30,
			exit_advisory_interval_hours: 6,
		})
	})

	it("saves the churn period the retention report runs on", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const churn = screen.getByLabelText(/churn inactivity/i)
		await user.clear(churn)
		await user.type(churn, "45")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate.mock.calls[0]?.[0]).toMatchObject({ churn_inactivity_days: 45 })
	})

	it("refuses a churn period outside the contract's range, and says why", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const churn = screen.getByLabelText(/churn inactivity/i)
		await user.clear(churn)
		await user.type(churn, "400")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByText("Enter a whole number between 1 and 365 days.")).toBeInTheDocument()
		expect(churn).toHaveFocus()
	})

	it("offers every administrator-managed setting, not just the periods", async () => {
		render(<ModuleConfigurationView />)

		expect(screen.getByLabelText("Trivia repeat window (days)")).toBeInTheDocument()
		expect(screen.getByLabelText("Leaderboard enabled")).toBeInTheDocument()
		expect(screen.getByLabelText("Recognition confidence threshold")).toBeInTheDocument()
		expect(screen.getByLabelText("Small-group suppression minimum")).toBeInTheDocument()
		expect(screen.getByLabelText("Age groups")).toBeInTheDocument()
		expect(screen.getByLabelText("Active privacy notice version")).toBeInTheDocument()
	})

	it("saves a flag as a boolean rather than as text", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		await user.click(screen.getByLabelText("Leaderboard enabled"))
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate.mock.calls[0]?.[0]).toMatchObject({ leaderboard_enabled: true })
	})

	it("saves the key actions that are ticked", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		await user.click(screen.getByLabelText("survey_submitted"))
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate.mock.calls[0]?.[0].key_action_events).toEqual([
			"content_view",
			"feature_use",
			"survey_submitted",
		])
	})

	it("refuses to save with no key action at all", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		await user.click(screen.getByLabelText("content_view"))
		await user.click(screen.getByLabelText("feature_use"))
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		// Time-to-first-key-action with no key actions has nothing to wait for.
		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByText("Choose at least one key action.")).toBeInTheDocument()
	})

	it("reads age groups back as the boundaries the contract stores", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const groups = screen.getByLabelText("Age groups")
		expect(groups).toHaveValue("0-17, 18+")

		await user.clear(groups)
		await user.type(groups, "0-20, 21-40, 41+")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate.mock.calls[0]?.[0].age_group_buckets).toEqual([
			{ minAge: 0, maxAge: 20 },
			{ minAge: 21, maxAge: 40 },
			{ minAge: 41, maxAge: null },
		])
	})

	it("refuses age groups it cannot read, and says how to write them", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const groups = screen.getByLabelText("Age groups")
		await user.clear(groups)
		await user.type(groups, "young, old")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByText(/ending with an open one such as 60\+/)).toBeInTheDocument()
		expect(groups).toHaveFocus()
	})

	it("sends no notice version at all when the box is emptied", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		await user.clear(screen.getByLabelText("Active privacy notice version"))
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		// Null, not "": a module with no notice has not been given the empty one.
		expect(mutate.mock.calls[0]?.[0].active_privacy_notice_version).toBeNull()
	})

	it("refuses an interval outside the contract's range, and says why", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useUpdateConfig.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<ModuleConfigurationView />)

		const interval = screen.getByLabelText(/exit advisory interval/i)
		await user.clear(interval)
		await user.type(interval, "0")
		await user.click(screen.getByRole("button", { name: /save configuration/i }))

		expect(mutate).not.toHaveBeenCalled()
		expect(
			screen.getByText("Enter a whole number of hours between 1 and 8,760.")
		).toBeInTheDocument()
		// The field that is wrong is the one that gets focus.
		expect(interval).toHaveFocus()
	})
})
