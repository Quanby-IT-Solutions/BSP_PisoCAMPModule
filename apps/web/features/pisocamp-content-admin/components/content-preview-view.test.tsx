import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as PreviewHooks from "@/features/pisocamp-content-admin/api/preview.hooks"

import { ContentPreviewView } from "./content-preview-view"

const { usePreview } = vi.hoisted(() => ({ usePreview: vi.fn() }))

vi.mock("@/features/pisocamp-content-admin/api/preview.hooks", async () => {
	const actual = await vi.importActual<typeof PreviewHooks>(
		"@/features/pisocamp-content-admin/api/preview.hooks"
	)
	return {
		...actual,
		usePisoCampContentPreviewQuery: (input: unknown) => usePreview(input),
	}
})

const ITEM_ID = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const VERSION_ID = "d7e9984f-fd54-49d9-bb33-0a7c006c83fd"
const IMAGE_ASSET_ID = "0f1c0e2a-1111-4a2b-9c3d-4e5f60718293"
const AUDIO_ASSET_ID = "0f1c0e2a-2222-4a2b-9c3d-4e5f60718293"
const TOKEN = "v1.eyJhIjoxfQ.c2lnbmF0dXJl"

const grant = {
	token: TOKEN,
	expiresAt: "2026-09-02T01:05:00.000Z",
	preview: {
		itemId: ITEM_ID,
		versionId: VERSION_ID,
		versionNo: 4,
		status: "approved",
		contentType: "banknote",
		content: {
			contentType: "banknote",
			title: "PHP 100 banknote",
			summary: "Recognize the current PHP 100 banknote.",
			body: "Inspect the portrait, security thread and tactile marks.",
			seriesCode: "ngc-banknotes",
			denominationCode: "php-100",
		},
		relatedLinks: [
			{
				id: "2f08ac0e-8a78-4cee-b37c-88e2d63d8f8f",
				position: 0,
				kind: "external",
				label: "BSP banknotes",
				url: "https://www.bsp.gov.ph/banknotes",
			},
		],
		assets: [
			{
				role: "obverse",
				assetId: IMAGE_ASSET_ID,
				mediaType: "image/png",
				byteLength: 128,
				sha256: "a".repeat(64),
			},
			{
				role: "audio",
				assetId: AUDIO_ASSET_ID,
				mediaType: "audio/mpeg",
				byteLength: 256,
				sha256: "b".repeat(64),
			},
		],
		generatedAt: "2026-09-02T01:00:00.000Z",
	},
}

function loaded(overrides: Record<string, unknown> = {}) {
	return { isPending: false, isError: false, data: grant, refetch: vi.fn(), ...overrides }
}

describe("ContentPreviewView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		usePreview.mockReturnValue(loaded())
	})

	it("requests the exact item and version it was mounted for", () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		expect(usePreview).toHaveBeenCalledWith({ itemId: ITEM_ID, versionNo: 4 })
	})

	it("renders the end-user layout with copy, currency fields and related links", () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		expect(screen.getByRole("heading", { name: "PHP 100 banknote" })).toBeInTheDocument()
		expect(screen.getByText("Recognize the current PHP 100 banknote.")).toBeInTheDocument()
		expect(
			screen.getByText("Inspect the portrait, security thread and tactile marks.")
		).toBeInTheDocument()
		expect(screen.getByText("ngc-banknotes")).toBeInTheDocument()
		expect(screen.getByText("php-100")).toBeInTheDocument()
		expect(screen.getByText("BSP banknotes")).toBeInTheDocument()
	})

	it("states in words that a preview publishes nothing and bundles nothing", () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		const notice = screen.getByRole("status", { name: "" })
		expect(within(notice).getByText("Preview Only")).toBeInTheDocument()
		expect(
			screen.getByText(
				/does not publish anything and does not add this version to any offline bundle/i
			)
		).toBeInTheDocument()
	})

	it("renders images and an audio player addressed by the grant, never by a bare asset id", () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		const image = screen.getByRole("img", { name: "Obverse image of PHP 100 banknote" })
		expect(image.getAttribute("src")).toContain(
			`/pisocamp/preview/resources/${IMAGE_ASSET_ID}?token=${encodeURIComponent(TOKEN)}`
		)

		const player = screen.getByLabelText("Narration for PHP 100 banknote")
		expect(player.tagName).toBe("AUDIO")
		expect(player).toHaveAttribute("controls")
		expect(player.getAttribute("src")).toContain(
			`/pisocamp/preview/resources/${AUDIO_ASSET_ID}?token=${encodeURIComponent(TOKEN)}`
		)
	})

	it("renders a scannable preview code carrying the redemption link and its expiry", async () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		const code = await screen.findByRole("img", {
			name: "Preview code for the Piso CAMP preview build",
		})
		expect(code.querySelector("svg")).not.toBeNull()
		expect(screen.getByTestId("preview-redeem-url").textContent).toContain(
			`/pisocamp/preview?token=${encodeURIComponent(TOKEN)}`
		)
		expect(screen.getByText(/This code stops working at/i)).toBeInTheDocument()
	})

	it("shows an accessible loading state while the grant is in flight", () => {
		usePreview.mockReturnValue({ isPending: true, isError: false, data: undefined })
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		expect(screen.getByRole("status", { name: "Loading preview…" })).toBeInTheDocument()
	})

	it("focuses a retryable error and re-requests the grant on demand", async () => {
		const refetch = vi.fn()
		usePreview.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(
			screen.getByText(/Only draft, submitted or approved versions can be previewed/i)
		).toBeInTheDocument()

		await userEvent.click(screen.getByRole("button", { name: "Try Again" }))
		expect(refetch).toHaveBeenCalledTimes(1)
	})

	it("explains an empty attachment set instead of rendering an empty gallery", () => {
		usePreview.mockReturnValue(
			loaded({ data: { ...grant, preview: { ...grant.preview, assets: [] } } })
		)
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		expect(screen.getByText("No assets are attached to this version.")).toBeInTheDocument()
		expect(screen.queryByRole("img", { name: /image of/ })).not.toBeInTheDocument()
	})

	it("keeps every preview control reachable by keyboard", async () => {
		render(<ContentPreviewView itemId={ITEM_ID} versionNo={4} />)

		const back = screen.getByRole("link", { name: "Back To Content" })
		back.focus()
		expect(back).toHaveFocus()
		expect(back).toHaveAttribute("href", `/pisocamp/content/${ITEM_ID}/edit`)
	})
})
