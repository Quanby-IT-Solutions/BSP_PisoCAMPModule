import { renderPublishedContentResources } from "./bundle-renderer"

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
