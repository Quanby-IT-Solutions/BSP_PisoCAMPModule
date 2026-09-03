import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NotificationsDashboard } from "./notifications-dashboard"

const useMetrics = vi.fn()
const send = vi.fn()

vi.mock("@/features/notifications/api/notifications.hooks", () => ({
	useNotificationMetricsQuery: (input: unknown) => useMetrics(input),
	useSendNotificationMutation: () => ({ mutate: send, isPending: false }),
}))

const metrics = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	registeredAccounts: 400,
	optedInAccounts: 120,
	optInRatePercent: 30,
	sent: 1,
	recipients: 120,
	delivered: 110,
	failed: 10,
	opened: 44,
	clicked: 12,
	deliveryRatePercent: 91.67,
	failedDeliveryRatePercent: 8.33,
	openRatePercent: 40,
	clickRatePercent: 10.91,
	reengagedOpens: 20,
	reengagementRatePercent: 45.45,
	notifications: [
		{
			id: "1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
			title: "New banknote features",
			sentAt: "2026-09-10T02:00:00.000Z",
			recipients: 120,
			delivered: 110,
			failed: 10,
			opened: 44,
			clicked: 12,
		},
	],
}

describe("NotificationsDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useMetrics.mockReturnValue({
			isPending: false,
			isError: false,
			data: metrics,
			refetch: vi.fn(),
		})
	})

	it("shows every rate with the pool it was computed from", () => {
		render(<NotificationsDashboard canSend={false} />)

		expect(screen.getByText("120 of 400 registered")).toBeInTheDocument()
		expect(screen.getByText("110 of 120 attempted")).toBeInTheDocument()
		expect(screen.getByText("44 of what arrived")).toBeInTheDocument()
		expect(
			screen.getByText("20 opens followed by a session within 24 hours")
		).toBeInTheDocument()
	})

	it("lists what was sent in the range", () => {
		render(<NotificationsDashboard canSend={false} />)

		expect(screen.getByRole("cell", { name: "New banknote features" })).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "2026-09-10" })).toBeInTheDocument()
	})

	it("offers the send form only to somebody who may send", () => {
		render(<NotificationsDashboard canSend={false} />)

		expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument()
	})

	it("asks for confirmation before sending to everybody", async () => {
		const user = userEvent.setup()
		render(<NotificationsDashboard canSend />)

		await user.type(screen.getByLabelText("Title"), "New banknote features")
		await user.type(screen.getByLabelText("Message"), "Learn what changed.")
		await user.type(screen.getByLabelText("Approval reference"), "BSP-COMMS-2026-014")
		await user.click(screen.getByRole("button", { name: "Send" }))

		// A notification cannot be taken back, so it asks first.
		expect(screen.getByText("This goes to every opted-in device")).toBeInTheDocument()
		expect(send).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Send Now" }))

		expect(send).toHaveBeenCalledTimes(1)
		expect(send.mock.calls[0]?.[0]).toEqual({
			title: "New banknote features",
			body: "Learn what changed.",
			deepLink: null,
			approvalReference: "BSP-COMMS-2026-014",
		})
	})

	it("refuses a deep link that is not an internal path", async () => {
		const user = userEvent.setup()
		render(<NotificationsDashboard canSend />)

		await user.type(screen.getByLabelText("Title"), "Title")
		await user.type(screen.getByLabelText("Message"), "Body")
		await user.type(screen.getByLabelText("Approval reference"), "BSP-COMMS-2026-014")
		await user.type(screen.getByLabelText("Deep link (optional)"), "https://example.test")
		await user.click(screen.getByRole("button", { name: "Send" }))

		// A push that could open any URL would be a phishing surface with BSP's
		// name on it.
		expect(send).not.toHaveBeenCalled()
		expect(document.querySelector("#notification-error")).toHaveTextContent(
			/internal path/
		)
	})

	it("lets somebody change their mind before confirming", async () => {
		const user = userEvent.setup()
		render(<NotificationsDashboard canSend />)

		await user.type(screen.getByLabelText("Title"), "Title")
		await user.type(screen.getByLabelText("Message"), "Body")
		await user.type(screen.getByLabelText("Approval reference"), "BSP-COMMS-2026-014")
		await user.click(screen.getByRole("button", { name: "Send" }))
		await user.click(screen.getByRole("button", { name: "Cancel" }))

		expect(screen.queryByText("This goes to every opted-in device")).not.toBeInTheDocument()
		expect(send).not.toHaveBeenCalled()
	})

	it("offers a way back when the metrics could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useMetrics.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<NotificationsDashboard canSend={false} />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
