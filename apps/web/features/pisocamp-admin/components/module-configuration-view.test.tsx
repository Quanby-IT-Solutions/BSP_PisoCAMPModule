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
			{
				session_inactivity_minutes: 45,
				exit_advisory_interval_hours: 24,
				churn_inactivity_days: 30,
			},
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
		expect(mutate.mock.calls[0]?.[0]).toEqual({
			session_inactivity_minutes: 30,
			exit_advisory_interval_hours: 6,
			churn_inactivity_days: 30,
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

		expect(mutate.mock.calls[0]?.[0]).toEqual({
			session_inactivity_minutes: 30,
			exit_advisory_interval_hours: 24,
			churn_inactivity_days: 45,
		})
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
