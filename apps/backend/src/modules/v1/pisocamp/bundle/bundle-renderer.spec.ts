import { createHash } from "node:crypto"

import {
	RECOGNITION_DESCRIPTOR_LOGICAL_ID,
	RECOGNITION_WEIGHTS_LOGICAL_ID,
	renderPublishedContentResources,
	renderRecognitionModelResources,
} from "./bundle-renderer"

describe("renderPublishedContentResources", () => {
	it("renders exact compact UTF-8 bytes in frozen key order without internal identities", () => {
		const resources = renderPublishedContentResources([
			{
				itemId: "11111111-1111-4111-8111-111111111111",
				versionId: "22222222-2222-4222-8222-222222222222",
				versionNo: 7,
				content: {
					contentType: "link",
					title: "BSP currency guide",
					summary: "Plain <b>text</b> remains text.",
					body: "Optional details",
					primaryUrl: "https://www.bsp.gov.ph/currency",
				},
				surveyQuestions: null,
		relatedLinks: [
					{
						id: "33333333-3333-4333-8333-333333333333",
						position: 0,
						kind: "external",
						label: "BSP",
						url: "https://www.bsp.gov.ph/Pages/CoinsAndNotes/CoinsAndNotes.aspx",
					},
				],
			},
		])

		expect(resources).toHaveLength(1)
		expect(resources[0]!.logicalId).toBe("content.11111111-1111-4111-8111-111111111111")
		expect(resources[0]!.bytes.toString("utf8")).toBe(
			'{"schemaVersion":1,"logicalId":"content.11111111-1111-4111-8111-111111111111","contentItemId":"11111111-1111-4111-8111-111111111111","contentVersionId":"22222222-2222-4222-8222-222222222222","versionNo":7,"contentType":"link","title":"BSP currency guide","summary":"Plain <b>text</b> remains text.","body":"Optional details","seriesCode":null,"denominationCode":null,"primaryUrl":"https://www.bsp.gov.ph/currency","featureLevel":null,"hotspot":null,"relatedLinks":[{"id":"33333333-3333-4333-8333-333333333333","position":0,"kind":"external","label":"BSP","url":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/CoinsAndNotes.aspx"}]}'
		)
		const parsed = JSON.parse(resources[0]!.bytes.toString("utf8")) as Record<string, unknown>
		expect(Object.keys(parsed)).toEqual([
			"schemaVersion",
			"logicalId",
			"contentItemId",
			"contentVersionId",
			"versionNo",
			"contentType",
			"title",
			"summary",
			"body",
			"seriesCode",
			"denominationCode",
			"primaryUrl",
			"featureLevel",
			"hotspot",
			"relatedLinks",
		])
		expect(resources[0]!.bytes.toString("utf8")).not.toMatch(
			/approvedBy|publishedBy|createdBy|bundlePending|transitionComments/
		)
	})

	it("sorts by logical ID and never fetches primary or related URLs", () => {
		const fetchSpy = jest.spyOn(global, "fetch")
		const makeCandidate = (itemId: string) => ({
			itemId,
			versionId: "22222222-2222-4222-8222-222222222222",
			versionNo: 1,
			content: {
				contentType: "advisory" as const,
				title: "Title",
				summary: "Summary",
				body: "Body",
			},
			surveyQuestions: null,
			relatedLinks: [],
		})

		const result = renderPublishedContentResources([
			makeCandidate("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
			makeCandidate("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
		])

		expect(result.map(resource => resource.logicalId)).toEqual([
			"content.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			"content.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		])
		expect(fetchSpy).not.toHaveBeenCalled()
		fetchSpy.mockRestore()
	})
})

describe("DR-4 renderRecognitionModelResources", () => {
	const model = {
		version: "2026.09.1",
		thresholds: { confidence: 0.85, dwellSeconds: 8 },
		classes: [
			{ classId: 0, outcome: "denomination", label: "Twenty pesos", denominationCode: "PHP20" },
			{ classId: 1, outcome: "foreign" },
		],
		weightsSha256: "a".repeat(64),
		weightsByteLength: 4096,
	}

	it("carries the thresholds with the model that was approved with them", () => {
		const [descriptor] = renderRecognitionModelResources(model)

		expect(descriptor!.logicalId).toBe(RECOGNITION_DESCRIPTOR_LOGICAL_ID)
		const parsed = JSON.parse(descriptor!.bytes.toString("utf8")) as Record<string, unknown>
		// The device reads both from the same file, so a confidence tuned
		// against one set of weights cannot end up governing another.
		expect(parsed).toMatchObject({
			schemaVersion: 1,
			version: "2026.09.1",
			thresholds: { confidence: 0.85, dwellSeconds: 8 },
		})
		expect(descriptor!.sha256).toBe(
			createHash("sha256").update(descriptor!.bytes).digest("hex")
		)
		expect(descriptor!.kind).toBe("recognition_model")
		expect(descriptor!.mediaType).toBe("application/json")
	})

	it("points at the stored weights without carrying them", () => {
		const [, weights] = renderRecognitionModelResources(model)

		expect(weights!.logicalId).toBe(RECOGNITION_WEIGHTS_LOGICAL_ID)
		expect(weights!.sha256).toBe(model.weightsSha256)
		expect(weights!.byteLength).toBe(model.weightsByteLength)
		expect(weights!.mediaType).toBe("application/octet-stream")
		// Reading several megabytes into every build to hash them again would
		// prove nothing the stored digest does not already say.
		expect(weights!.bytes).toHaveLength(0)
	})

	it("owns neither entry as content, because no content version made them", () => {
		for (const resource of renderRecognitionModelResources(model)) {
			expect(resource.contentItemId).toBeNull()
			expect(resource.contentVersionId).toBeNull()
			expect(resource.delivery).toBe("core")
		}
	})
})
