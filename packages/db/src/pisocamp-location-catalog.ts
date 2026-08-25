/**
 * Frozen city-level subset of the PSA Philippine Standard Geographic Code as of 30 June 2026.
 * Generated from the official per-region HTML city tables because the publication XLSX is
 * Cloudflare-protected in CI. Municipalities are deliberately excluded.
 */
export const PISOCAMP_LOCATION_VERSION = "PSGC-2Q-2026" as const
export const PISOCAMP_LOCATION_SOURCE_URL =
	"https://psa.gov.ph/classification/psgc/summary" as const
export const PISOCAMP_LOCATION_PROVENANCE = [
	["0100000000", 9],
	["0200000000", 4],
	["0300000000", 15],
	["0400000000", 22],
	["0500000000", 7],
	["0600000000", 3],
	["0700000000", 10],
	["0800000000", 7],
	["0900000000", 5],
	["1000000000", 9],
	["1100000000", 6],
	["1200000000", 4],
	["1300000000", 16],
	["1400000000", 2],
	["1600000000", 6],
	["1700000000", 2],
	["1800000000", 19],
	["1900000000", 3],
].map(([regionCode, expectedCityCount]) => ({
	regionCode: regionCode as string,
	expectedCityCount: expectedCityCount as number,
	url: `https://psa.gov.ph/classification/psgc/cities/${regionCode}`,
}))
export const PISOCAMP_LOCATION_CATALOG = [
	{
		code: "0100000000",
		name: "Region I (Ilocos Region)",
		cities: [
			{
				code: "0102805000",
				name: "City of Batac",
			},
			{
				code: "0102812000",
				name: "City of Laoag",
			},
			{
				code: "0102906000",
				name: "City of Candon",
			},
			{
				code: "0102934000",
				name: "City of Vigan",
			},
			{
				code: "0103314000",
				name: "City of San Fernando",
			},
			{
				code: "0105503000",
				name: "City of Alaminos",
			},
			{
				code: "0105518000",
				name: "City of Dagupan",
			},
			{
				code: "0105532000",
				name: "City of San Carlos",
			},
			{
				code: "0105546000",
				name: "City of Urdaneta",
			},
		],
	},
	{
		code: "0200000000",
		name: "Region II (Cagayan Valley)",
		cities: [
			{
				code: "0201529000",
				name: "Tuguegarao City",
			},
			{
				code: "0203108000",
				name: "City of Cauayan",
			},
			{
				code: "0203114000",
				name: "City of Ilagan",
			},
			{
				code: "0203135000",
				name: "City of Santiago",
			},
		],
	},
	{
		code: "0300000000",
		name: "Region III (Central Luzon)",
		cities: [
			{
				code: "0300803000",
				name: "City of Balanga",
			},
			{
				code: "0301403000",
				name: "City of Baliwag",
			},
			{
				code: "0301410000",
				name: "City of Malolos",
			},
			{
				code: "0301412000",
				name: "City of Meycauayan",
			},
			{
				code: "0301420000",
				name: "City of San Jose Del Monte",
			},
			{
				code: "0304903000",
				name: "City of Cabanatuan",
			},
			{
				code: "0304908000",
				name: "City of Gapan",
			},
			{
				code: "0304917000",
				name: "Science City of Muñoz",
			},
			{
				code: "0304919000",
				name: "City of Palayan",
			},
			{
				code: "0304926000",
				name: "San Jose City",
			},
			{
				code: "0305409000",
				name: "Mabalacat City",
			},
			{
				code: "0305416000",
				name: "City of San Fernando",
			},
			{
				code: "0306916000",
				name: "City of Tarlac",
			},
			{
				code: "0330100000",
				name: "City of Angeles",
			},
			{
				code: "0331400000",
				name: "City of Olongapo",
			},
		],
	},
	{
		code: "0400000000",
		name: "Region IV-A (CALABARZON)",
		cities: [
			{
				code: "0401005000",
				name: "Batangas City",
			},
			{
				code: "0401007000",
				name: "City of Calaca",
			},
			{
				code: "0401014000",
				name: "City of Lipa",
			},
			{
				code: "0401028000",
				name: "City of Sto. Tomas",
			},
			{
				code: "0401031000",
				name: "City of Tanauan",
			},
			{
				code: "0402103000",
				name: "City of Bacoor",
			},
			{
				code: "0402104000",
				name: "City of Carmona",
			},
			{
				code: "0402105000",
				name: "City of Cavite",
			},
			{
				code: "0402106000",
				name: "City of Dasmariñas",
			},
			{
				code: "0402108000",
				name: "City of General Trias",
			},
			{
				code: "0402109000",
				name: "City of Imus",
			},
			{
				code: "0402119000",
				name: "City of Tagaytay",
			},
			{
				code: "0402122000",
				name: "City of Trece Martires",
			},
			{
				code: "0403403000",
				name: "City of Biñan",
			},
			{
				code: "0403404000",
				name: "City of Cabuyao",
			},
			{
				code: "0403405000",
				name: "City of Calamba",
			},
			{
				code: "0403424000",
				name: "City of San Pablo",
			},
			{
				code: "0403425000",
				name: "City of San Pedro",
			},
			{
				code: "0403428000",
				name: "City of Santa Rosa",
			},
			{
				code: "0405647000",
				name: "City of Tayabas",
			},
			{
				code: "0405802000",
				name: "City of Antipolo",
			},
			{
				code: "0431200000",
				name: "City of Lucena",
			},
		],
	},
	{
		code: "0500000000",
		name: "Region V (Bicol Region)",
		cities: [
			{
				code: "0500506000",
				name: "City of Legazpi",
			},
			{
				code: "0500508000",
				name: "City of Ligao",
			},
			{
				code: "0500517000",
				name: "City of Tabaco",
			},
			{
				code: "0501716000",
				name: "City of Iriga",
			},
			{
				code: "0501724000",
				name: "City of Naga",
			},
			{
				code: "0504111000",
				name: "City of Masbate",
			},
			{
				code: "0506216000",
				name: "City of Sorsogon",
			},
		],
	},
	{
		code: "0600000000",
		name: "Region VI (Western Visayas)",
		cities: [
			{
				code: "0601914000",
				name: "City of Roxas",
			},
			{
				code: "0603035000",
				name: "City of Passi",
			},
			{
				code: "0631000000",
				name: "City of Iloilo",
			},
		],
	},
	{
		code: "0700000000",
		name: "Region VII (Central Visayas)",
		cities: [
			{
				code: "0701242000",
				name: "City of Tagbilaran",
			},
			{
				code: "0702211000",
				name: "City of Bogo",
			},
			{
				code: "0702214000",
				name: "City of Carcar",
			},
			{
				code: "0702223000",
				name: "Danao City",
			},
			{
				code: "0702234000",
				name: "City of Naga",
			},
			{
				code: "0702250000",
				name: "City of Talisay",
			},
			{
				code: "0702251000",
				name: "City of Toledo",
			},
			{
				code: "0730600000",
				name: "City of Cebu",
			},
			{
				code: "0731100000",
				name: "City of Lapu-Lapu",
			},
			{
				code: "0731300000",
				name: "City of Mandaue",
			},
		],
	},
	{
		code: "0800000000",
		name: "Region VIII (Eastern Visayas)",
		cities: [
			{
				code: "0802604000",
				name: "City of Borongan",
			},
			{
				code: "0803708000",
				name: "City of Baybay",
			},
			{
				code: "0803738000",
				name: "Ormoc City",
			},
			{
				code: "0806003000",
				name: "City of Calbayog",
			},
			{
				code: "0806005000",
				name: "City of Catbalogan",
			},
			{
				code: "0806407000",
				name: "City of Maasin",
			},
			{
				code: "0831600000",
				name: "City of Tacloban",
			},
		],
	},
	{
		code: "0900000000",
		name: "Region IX (Zamboanga Peninsula)",
		cities: [
			{
				code: "0907201000",
				name: "City of Dapitan",
			},
			{
				code: "0907202000",
				name: "City of Dipolog",
			},
			{
				code: "0907322000",
				name: "City of Pagadian",
			},
			{
				code: "0931700000",
				name: "City of Zamboanga",
			},
			{
				code: "0990101000",
				name: "City of Isabela",
			},
		],
	},
	{
		code: "1000000000",
		name: "Region X (Northern Mindanao)",
		cities: [
			{
				code: "1001312000",
				name: "City of Malaybalay",
			},
			{
				code: "1001321000",
				name: "City of Valencia",
			},
			{
				code: "1004209000",
				name: "City of Oroquieta",
			},
			{
				code: "1004210000",
				name: "City of Ozamiz",
			},
			{
				code: "1004215000",
				name: "City of Tangub",
			},
			{
				code: "1004307000",
				name: "City of El Salvador",
			},
			{
				code: "1004308000",
				name: "City of Gingoog",
			},
			{
				code: "1030500000",
				name: "City of Cagayan De Oro",
			},
			{
				code: "1030900000",
				name: "City of Iligan",
			},
		],
	},
	{
		code: "1100000000",
		name: "Region XI (Davao Region)",
		cities: [
			{
				code: "1102315000",
				name: "City of Panabo",
			},
			{
				code: "1102317000",
				name: "Island Garden City of Samal",
			},
			{
				code: "1102319000",
				name: "City of Tagum",
			},
			{
				code: "1102403000",
				name: "City of Digos",
			},
			{
				code: "1102509000",
				name: "City of Mati",
			},
			{
				code: "1130700000",
				name: "City of Davao",
			},
		],
	},
	{
		code: "1200000000",
		name: "Region XII (SOCCSKSARGEN)",
		cities: [
			{
				code: "1204704000",
				name: "City of Kidapawan",
			},
			{
				code: "1206306000",
				name: "City of Koronadal",
			},
			{
				code: "1206511000",
				name: "City of Tacurong",
			},
			{
				code: "1230800000",
				name: "City of General Santos",
			},
		],
	},
	{
		code: "1300000000",
		name: "National Capital Region (NCR)",
		cities: [
			{
				code: "1380100000",
				name: "City of Caloocan",
			},
			{
				code: "1380200000",
				name: "City of Las Piñas",
			},
			{
				code: "1380300000",
				name: "City of Makati",
			},
			{
				code: "1380400000",
				name: "City of Malabon",
			},
			{
				code: "1380500000",
				name: "City of Mandaluyong",
			},
			{
				code: "1380600000",
				name: "City of Manila",
			},
			{
				code: "1380700000",
				name: "City of Marikina",
			},
			{
				code: "1380800000",
				name: "City of Muntinlupa",
			},
			{
				code: "1380900000",
				name: "City of Navotas",
			},
			{
				code: "1381000000",
				name: "City of Parañaque",
			},
			{
				code: "1381100000",
				name: "Pasay City",
			},
			{
				code: "1381200000",
				name: "City of Pasig",
			},
			{
				code: "1381300000",
				name: "Quezon City",
			},
			{
				code: "1381400000",
				name: "City of San Juan",
			},
			{
				code: "1381500000",
				name: "City of Taguig",
			},
			{
				code: "1381600000",
				name: "City of Valenzuela",
			},
		],
	},
	{
		code: "1400000000",
		name: "Cordillera Administrative Region (CAR)",
		cities: [
			{
				code: "1403213000",
				name: "City of Tabuk",
			},
			{
				code: "1430300000",
				name: "City of Baguio",
			},
		],
	},
	{
		code: "1600000000",
		name: "Region XIII (Caraga)",
		cities: [
			{
				code: "1600203000",
				name: "City of Cabadbaran",
			},
			{
				code: "1600301000",
				name: "City of Bayugan",
			},
			{
				code: "1606724000",
				name: "City of Surigao",
			},
			{
				code: "1606803000",
				name: "City of Bislig",
			},
			{
				code: "1606819000",
				name: "City of Tandag",
			},
			{
				code: "1630400000",
				name: "City of Butuan",
			},
		],
	},
	{
		code: "1700000000",
		name: "MIMAROPA Region",
		cities: [
			{
				code: "1705205000",
				name: "City of Calapan",
			},
			{
				code: "1731500000",
				name: "City of Puerto Princesa",
			},
		],
	},
	{
		code: "1800000000",
		name: "Negros Island Region (NIR)",
		cities: [
			{
				code: "1804502000",
				name: "City of Bago",
			},
			{
				code: "1804504000",
				name: "City of Cadiz",
			},
			{
				code: "1804509000",
				name: "City of Escalante",
			},
			{
				code: "1804510000",
				name: "City of Himamaylan",
			},
			{
				code: "1804515000",
				name: "City of Kabankalan",
			},
			{
				code: "1804516000",
				name: "City of La Carlota",
			},
			{
				code: "1804523000",
				name: "City of Sagay",
			},
			{
				code: "1804524000",
				name: "City of San Carlos",
			},
			{
				code: "1804526000",
				name: "City of Silay",
			},
			{
				code: "1804527000",
				name: "City of Sipalay",
			},
			{
				code: "1804528000",
				name: "City of Talisay",
			},
			{
				code: "1804531000",
				name: "City of Victorias",
			},
			{
				code: "1804604000",
				name: "City of Bais",
			},
			{
				code: "1804606000",
				name: "City of Bayawan",
			},
			{
				code: "1804608000",
				name: "City of Canlaon",
			},
			{
				code: "1804610000",
				name: "City of Dumaguete",
			},
			{
				code: "1804611000",
				name: "City of Guihulngan",
			},
			{
				code: "1804621000",
				name: "City of Tanjay",
			},
			{
				code: "1830200000",
				name: "City of Bacolod",
			},
		],
	},
	{
		code: "1900000000",
		name: "Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)",
		cities: [
			{
				code: "1900702000",
				name: "City of Lamitan",
			},
			{
				code: "1903617000",
				name: "City of Marawi",
			},
			{
				code: "1908703000",
				name: "City of Cotabato",
			},
		],
	},
] as const

export const PISOCAMP_LOCATION_CATALOG_SHA256 =
	"d346ceb5d7ecc4f6ead8471e4b498542c5ce91ae37b179904893ef2ec7f4667c" as const
