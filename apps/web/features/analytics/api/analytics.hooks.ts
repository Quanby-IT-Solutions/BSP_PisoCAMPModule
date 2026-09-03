"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type {
	AdoptionSummary,
	GamificationSummary,
	SurveyMetricsSummary,
	EngagementRangeInput,
	EngagementSummary,
	ModuleEntryToday,
	RetentionSummary,
	PerformanceTestResultView,
	RecordPerformanceTestInput,
	TechnicalMetricsSummary,
	DemographicDrilldown,
	DemographicDrilldownInput,
	DemographicsSummary,
} from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function useModuleEntryTodayQuery({ enabled }: { enabled: boolean }) {
	const options = orpc.pisocamp.analytics.moduleEntryToday.queryOptions({
		enabled,
		networkMode: "online",
		staleTime: 60_000,
	})

	// oRPC and React Query currently resolve nominally distinct QueryClient
	// declarations in this workspace. Their runtime option shapes are identical.
	return useQuery<ModuleEntryToday, Error>(
		options as unknown as UseQueryOptions<ModuleEntryToday, Error>
	)
}

export function useEngagementSummaryQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.engagement.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<EngagementSummary, Error>(
		options as unknown as UseQueryOptions<EngagementSummary, Error>
	)
}

export function useRetentionSummaryQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.retention.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<RetentionSummary, Error>(
		options as unknown as UseQueryOptions<RetentionSummary, Error>
	)
}

export function useGamificationSummaryQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.gamification.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<GamificationSummary, Error>(
		options as unknown as UseQueryOptions<GamificationSummary, Error>
	)
}

export function useSurveyMetricsQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.surveys.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<SurveyMetricsSummary, Error>(
		options as unknown as UseQueryOptions<SurveyMetricsSummary, Error>
	)
}

export function useTechnicalMetricsQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.technical.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<TechnicalMetricsSummary, Error>(
		options as unknown as UseQueryOptions<TechnicalMetricsSummary, Error>
	)
}

/**
 * AN-025's manual entry.
 *
 * Invalidates the technical figures on success, because the run somebody just
 * recorded belongs in the table above the form they recorded it in.
 */
export function useRecordPerformanceTestMutation() {
	const queryClient = useQueryClient()

	return useMutation<PerformanceTestResultView, Error, RecordPerformanceTestInput>({
		mutationFn: input =>
			orpc.pisocamp.monitoring.recordPerformanceTest.call(
				input
			) as unknown as Promise<PerformanceTestResultView>,
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.pisocamp.analytics.technical.key() }),
	})
}

export function useDemographicsSummaryQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.demographics.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<DemographicsSummary, Error>(
		options as unknown as UseQueryOptions<DemographicsSummary, Error>
	)
}

/**
 * §4.2-M's drill-down.
 *
 * Never prefetched and never part of the summary: row-level data is fetched
 * only when somebody with `reports.pii.view` asks for a particular group, and
 * the server audits each request.
 */
export function useDemographicDrilldownQuery(input: DemographicDrilldownInput) {
	const options = orpc.pisocamp.analytics.demographicDrilldown.queryOptions({
		input,
		networkMode: "online",
		staleTime: 0,
	})

	return useQuery<DemographicDrilldown, Error>(
		options as unknown as UseQueryOptions<DemographicDrilldown, Error>
	)
}

export function useAdoptionSummaryQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.analytics.adoption.queryOptions({
		input,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<AdoptionSummary, Error>(
		options as unknown as UseQueryOptions<AdoptionSummary, Error>
	)
}
