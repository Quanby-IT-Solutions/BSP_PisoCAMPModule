import {
	CreatePisoCampContentInputSchema,
	UpdatePisoCampContentInputSchema,
	type CreatePisoCampContentInput,
	type PisoCampContentType,
	type UpdatePisoCampContentInput,
} from "@repo/contracts"

export interface TriviaChoiceFormValue {
	clientId: string
	label: string
	correct: boolean
}

export interface RelatedLinkFormValue {
	clientId: string
	kind: "external" | "internal" | "topic"
	label: string
	value: string
}

export interface ContentFormValues {
	contentType: PisoCampContentType
	title: string
	summary: string
	body: string
	seriesCode: string
	denominationCode: string
	primaryUrl: string
	/** Security features only; "" until the editor has classified one. */
	featureLevel: "" | "first" | "second"
	/** Permille of the image's width and height, as typed. */
	hotspotX: string
	hotspotY: string
	/** Trivia questions only. */
	category: string
	difficulty: "" | "easy" | "medium" | "hard"
	choices: TriviaChoiceFormValue[]
	active: boolean
	relatedLinks: RelatedLinkFormValue[]
}

/**
 * A hotspot is only sent when both coordinates are given: half a position is
 * not a position, and the contract and the database both refuse one.
 */
function rawHotspot(values: ContentFormValues) {
	const x = values.hotspotX.trim()
	const y = values.hotspotY.trim()
	if (!x && !y) return {}
	// A blank coordinate is left out rather than sent as zero, so the schema
	// reports the missing half instead of quietly anchoring to a corner.
	return { hotspot: { ...(x ? { x: Number(x) } : {}), ...(y ? { y: Number(y) } : {}) } }
}

interface CatalogOption {
	code: string
	label: string
}

interface SeriesOption extends CatalogOption {
	mediaKind: "banknote" | "coin"
	denominations: readonly CatalogOption[]
}

const php = (code: string, label: string): CatalogOption => ({ code, label })

/** UI projection of the frozen, source-backed catalog seeded by CM-1 Task 2. */
export const CURRENCY_SERIES_OPTIONS: readonly SeriesOption[] = [
	{
		code: "fpp-banknotes",
		label: "First Philippine Polymer Banknote Series",
		mediaKind: "banknote",
		denominations: [
			php("php-50", "PHP 50"),
			php("php-100", "PHP 100"),
			php("php-500", "PHP 500"),
			php("php-1000", "PHP 1,000"),
		],
	},
	{
		code: "engc-banknotes",
		label: "Enhanced New Generation Currency Banknotes",
		mediaKind: "banknote",
		denominations: [
			php("php-50", "PHP 50"),
			php("php-100", "PHP 100"),
			php("php-200", "PHP 200"),
			php("php-500", "PHP 500"),
			php("php-1000", "PHP 1,000"),
		],
	},
	{
		code: "ngc-banknotes",
		label: "New Generation Currency Banknotes",
		mediaKind: "banknote",
		denominations: [
			php("php-20", "PHP 20"),
			php("php-50", "PHP 50"),
			php("php-100", "PHP 100"),
			php("php-200", "PHP 200"),
			php("php-500", "PHP 500"),
			php("php-1000", "PHP 1,000"),
		],
	},
	{
		code: "ngc-coins",
		label: "New Generation Currency Coin Series",
		mediaKind: "coin",
		denominations: [
			php("sentimo-1", "1 Sentimo"),
			php("sentimo-5", "5 Sentimo"),
			php("sentimo-25", "25 Sentimo"),
			php("php-1", "PHP 1"),
			php("php-5", "PHP 5"),
			php("php-10", "PHP 10"),
			php("php-20", "PHP 20"),
		],
	},
	{
		code: "bsp-coin-series",
		label: "BSP Coin Series",
		mediaKind: "coin",
		denominations: [
			php("sentimo-1", "1 Sentimo"),
			php("sentimo-5", "5 Sentimo"),
			php("sentimo-10", "10 Sentimo"),
			php("sentimo-25", "25 Sentimo"),
			php("php-1", "PHP 1"),
			php("php-5", "PHP 5"),
			php("php-10", "PHP 10"),
		],
	},
] as const

export function emptyTriviaChoice(
	generate: () => string = () => crypto.randomUUID()
): TriviaChoiceFormValue {
	return { clientId: generate(), label: "", correct: false }
}

/** The most choices a question may offer, from the contract. */
export const MAXIMUM_TRIVIA_CHOICES = 6
export const MINIMUM_TRIVIA_CHOICES = 2

export function createEmptyContentForm(contentType: PisoCampContentType): ContentFormValues {
	return {
		contentType,
		title: "",
		summary: "",
		body: "",
		seriesCode: "",
		denominationCode: "",
		primaryUrl: "",
		featureLevel: "",
		hotspotX: "",
		hotspotY: "",
		category: "",
		difficulty: "",
		// Two blank choices, because a question needs at least two and an empty
		// list makes the editor guess how many to add.
		choices: [emptyTriviaChoice(), emptyTriviaChoice()],
		active: true,
		relatedLinks: [],
	}
}

export function getSeriesOptions(contentType: PisoCampContentType): readonly SeriesOption[] {
	if (contentType === "banknote") {
		return CURRENCY_SERIES_OPTIONS.filter(option => option.mediaKind === "banknote")
	}
	if (contentType === "coin") {
		return CURRENCY_SERIES_OPTIONS.filter(option => option.mediaKind === "coin")
	}
	if (contentType === "security_feature") return CURRENCY_SERIES_OPTIONS
	return []
}

export function getDenominationOptions(seriesCode: string): readonly CatalogOption[] {
	return CURRENCY_SERIES_OPTIONS.find(option => option.code === seriesCode)?.denominations ?? []
}

export function changeCurrencySeries(
	values: ContentFormValues,
	seriesCode: string
): ContentFormValues {
	const denominationIsValid = getDenominationOptions(seriesCode).some(
		option => option.code === values.denominationCode
	)
	return {
		...values,
		seriesCode,
		denominationCode: denominationIsValid ? values.denominationCode : "",
	}
}

export function changeContentType(
	values: ContentFormValues,
	contentType: PisoCampContentType
): ContentFormValues {
	const supportsCurrency = ["banknote", "coin", "security_feature"].includes(contentType)
	const seriesIsValid = getSeriesOptions(contentType).some(
		option => option.code === values.seriesCode
	)
	const next = {
		...values,
		contentType,
		primaryUrl: contentType === "link" ? values.primaryUrl : "",
		seriesCode: supportsCurrency && seriesIsValid ? values.seriesCode : "",
		denominationCode: supportsCurrency && seriesIsValid ? values.denominationCode : "",
	}
	return changeCurrencySeries(next, next.seriesCode)
}

function rawRelatedLinks(values: ContentFormValues) {
	return values.relatedLinks.map(link => {
		if (link.kind === "external") return { kind: link.kind, label: link.label, url: link.value }
		if (link.kind === "internal") return { kind: link.kind, label: link.label, route: link.value }
		return { kind: link.kind, label: link.label, targetContentItemId: link.value }
	})
}

function rawContent(values: ContentFormValues) {
	const common = { title: values.title, summary: values.summary, body: values.body }
	if (values.contentType === "banknote" || values.contentType === "coin") {
		return {
			...common,
			contentType: values.contentType,
			seriesCode: values.seriesCode,
			denominationCode: values.denominationCode,
		}
	}
	if (values.contentType === "security_feature") {
		return {
			...common,
			contentType: values.contentType,
			seriesCode: values.seriesCode,
			denominationCode: values.denominationCode,
			featureLevel: values.featureLevel,
			...rawHotspot(values),
		}
	}
	if (values.contentType === "trivia_question") {
		return {
			...common,
			contentType: values.contentType,
			category: values.category,
			difficulty: values.difficulty,
			choices: values.choices.map(choice => ({
				label: choice.label,
				correct: choice.correct,
			})),
			active: values.active,
		}
	}
	if (values.contentType === "link") {
		return {
			contentType: values.contentType,
			title: values.title,
			summary: values.summary,
			...(values.body.trim() ? { body: values.body } : {}),
			primaryUrl: values.primaryUrl,
		}
	}
	return { ...common, contentType: values.contentType }
}

export type ContentFormErrors = Record<string, string>
export type ContentRequestResult<T> =
	| { success: true; data: T }
	| { success: false; errors: ContentFormErrors }

function friendlyFieldName(key: string) {
	return (
		{
			title: "Title",
			summary: "Summary",
			body: "Body",
			seriesCode: "Currency series",
			denominationCode: "Denomination",
			primaryUrl: "Primary URL",
			featureLevel: "Disclosure level",
			hotspot: "Hotspot position",
			category: "Category",
			difficulty: "Difficulty",
			choices: "Choices",
			relatedLinks: "Related links",
		}[key] ?? "Field"
	)
}

function errorsFromIssues(
	issues: readonly { path: readonly PropertyKey[]; message: string }[],
	values: ContentFormValues
) {
	const errors: ContentFormErrors = {}
	for (const issue of issues) {
		const path = issue.path.map(String)
		if (path[0] === "relatedLinks") {
			const index = Number(path[1])
			const formKey = path[2] === "label" ? "label" : "value"
			const key = `relatedLinks.${index}.${formKey}`
			if (errors[key]) continue
			if (formKey === "label") {
				errors[key] = `Related link ${index + 1} label is required.`
				continue
			}
			const kind = values.relatedLinks[index]?.kind
			errors[key] =
				kind === "external"
					? `Related link ${index + 1} must use a valid HTTPS URL.`
					: kind === "internal"
						? `Related link ${index + 1} must use an absolute lower-case application route.`
						: `Related link ${index + 1} must reference a valid content item ID.`
			continue
		}

		const key = path[0] === "content" ? (path[1] ?? "content") : (path[0] ?? "form")
		if (errors[key]) continue
		if (key === "primaryUrl") {
			errors[key] = "Enter a valid HTTPS URL."
			continue
		}
		if (key === "choices") {
			// The contract reports the reason precisely; a generic "invalid" here
			// would tell an editor nothing about which rule they broke.
			errors[key] = issue.message
			continue
		}
		if (key === "hotspot") {
			errors[key] = "Enter both positions as whole numbers between 0 and 1000."
			continue
		}
		const required =
			issue.message.toLowerCase().includes("too small") ||
			((key === "seriesCode" || key === "denominationCode") && !values[key]) ||
			(key === "featureLevel" && !values.featureLevel) ||
			(key === "difficulty" && !values.difficulty) ||
			(key === "category" && !values.category)
		errors[key] = required ? `${friendlyFieldName(key)} is required.` : issue.message
	}
	return errors
}

export function buildCreateContentRequest(
	values: ContentFormValues,
	requestId: string
): ContentRequestResult<CreatePisoCampContentInput> {
	const parsed = CreatePisoCampContentInputSchema.safeParse({
		requestId,
		content: rawContent(values),
		relatedLinks: rawRelatedLinks(values),
	})
	return parsed.success
		? { success: true, data: parsed.data }
		: { success: false, errors: errorsFromIssues(parsed.error.issues, values) }
}

export function buildUpdateContentRequest(
	values: ContentFormValues,
	identity: Pick<UpdatePisoCampContentInput, "itemId" | "requestId" | "expectedVersionNo">
): ContentRequestResult<UpdatePisoCampContentInput> {
	const parsed = UpdatePisoCampContentInputSchema.safeParse({
		...identity,
		content: rawContent(values),
		relatedLinks: rawRelatedLinks(values),
	})
	return parsed.success
		? { success: true, data: parsed.data }
		: { success: false, errors: errorsFromIssues(parsed.error.issues, values) }
}

export function getOrCreateRequestId(
	existing: string | null,
	generate: () => string = () => crypto.randomUUID()
) {
	return existing ?? generate()
}
