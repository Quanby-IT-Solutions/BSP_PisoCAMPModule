import type { PisoCampCurrencyCatalog } from "@repo/contracts"

export const PISOCAMP_CURRENCY_CATALOG_VERSION = "BSP-CURRENCY-2026-08-25" as const

type CurrencySeries = PisoCampCurrencyCatalog["series"][number]
type FrozenCurrencySeries = Readonly<Omit<CurrencySeries, "denominations">> & {
	readonly denominations: readonly Readonly<CurrencySeries["denominations"][number]>[]
}

function denomination(code: string, label: string, minorUnitValue: number, sortOrder: number) {
	return Object.freeze({ code, label, minorUnitValue, sortOrder })
}

function series(value: CurrencySeries): FrozenCurrencySeries {
	return Object.freeze({ ...value, denominations: Object.freeze([...value.denominations]) })
}

/** Frozen, source-backed CM-1 currency catalog. Composite denomination identity is series + code. */
export const PISOCAMP_CURRENCY_CATALOG = Object.freeze([
	series({
		code: "fpp-banknotes",
		name: "First Philippine Polymer Banknote Series",
		mediaKind: "banknote",
		sourceUrl: "https://www.bsp.gov.ph/SitePages/CoinsAndNotes/PolymerBanknote.aspx",
		catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
		denominations: [
			denomination("php-50", "PHP 50", 5_000, 0),
			denomination("php-100", "PHP 100", 10_000, 1),
			denomination("php-500", "PHP 500", 50_000, 2),
			denomination("php-1000", "PHP 1,000", 100_000, 3),
		],
	}),
	series({
		code: "engc-banknotes",
		name: "Enhanced New Generation Currency Banknotes",
		mediaKind: "banknote",
		sourceUrl: "https://www.bsp.gov.ph/Coins%20and%20Notes/Educational%20Campaign/engc%20flyer.pdf",
		catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
		denominations: [
			denomination("php-50", "PHP 50", 5_000, 0),
			denomination("php-100", "PHP 100", 10_000, 1),
			denomination("php-200", "PHP 200", 20_000, 2),
			denomination("php-500", "PHP 500", 50_000, 3),
			denomination("php-1000", "PHP 1,000", 100_000, 4),
		],
	}),
	series({
		code: "ngc-banknotes",
		name: "New Generation Currency Banknotes",
		mediaKind: "banknote",
		sourceUrl: "https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx",
		catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
		denominations: [
			denomination("php-20", "PHP 20", 2_000, 0),
			denomination("php-50", "PHP 50", 5_000, 1),
			denomination("php-100", "PHP 100", 10_000, 2),
			denomination("php-200", "PHP 200", 20_000, 3),
			denomination("php-500", "PHP 500", 50_000, 4),
			denomination("php-1000", "PHP 1,000", 100_000, 5),
		],
	}),
	series({
		code: "ngc-coins",
		name: "New Generation Currency Coin Series",
		mediaKind: "coin",
		sourceUrl: "https://www.bsp.gov.ph/Media_and_Research/Primers%20Faqs/NGCCoins.pdf",
		catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
		denominations: [
			denomination("sentimo-1", "1 Sentimo", 1, 0),
			denomination("sentimo-5", "5 Sentimo", 5, 1),
			denomination("sentimo-25", "25 Sentimo", 25, 2),
			denomination("php-1", "PHP 1", 100, 3),
			denomination("php-5", "PHP 5", 500, 4),
			denomination("php-10", "PHP 10", 1_000, 5),
			denomination("php-20", "PHP 20", 2_000, 6),
		],
	}),
	series({
		code: "bsp-coin-series",
		name: "BSP Coin Series",
		mediaKind: "coin",
		sourceUrl: "https://www.bsp.gov.ph/SitePages/CoinsAndNotes/BSPCoinSeries.aspx",
		catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
		denominations: [
			denomination("sentimo-1", "1 Sentimo", 1, 0),
			denomination("sentimo-5", "5 Sentimo", 5, 1),
			denomination("sentimo-10", "10 Sentimo", 10, 2),
			denomination("sentimo-25", "25 Sentimo", 25, 3),
			denomination("php-1", "PHP 1", 100, 4),
			denomination("php-5", "PHP 5", 500, 5),
			denomination("php-10", "PHP 10", 1_000, 6),
		],
	}),
]) satisfies readonly FrozenCurrencySeries[]
