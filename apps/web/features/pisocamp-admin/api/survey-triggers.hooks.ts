"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	DeletePisoCampSurveyTriggerInput,
	ListPisoCampSurveyTriggersOutput,
	PisoCampSurveyTriggerRule,
	UpsertPisoCampSurveyTriggerInput,
} from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

export function usePisoCampSurveyTriggersQuery() {
	return useQuery<ListPisoCampSurveyTriggersOutput, Error>({
		queryKey: orpc.pisocamp.admin.surveyTriggers.list.queryKey({}),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.surveyTriggers.list({}, { signal }),
		networkMode: "online",
		staleTime: 0,
	})
}

export function useUpsertPisoCampSurveyTriggerMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampSurveyTriggerRule, Error, UpsertPisoCampSurveyTriggerInput>({
		mutationKey: orpc.pisocamp.admin.surveyTriggers.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.surveyTriggers.upsert(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})
}

export function useDeletePisoCampSurveyTriggerMutation() {
	const queryClient = useQueryClient()

	return useMutation<{ deleted: boolean }, Error, DeletePisoCampSurveyTriggerInput>({
		mutationKey: orpc.pisocamp.admin.surveyTriggers.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.surveyTriggers.remove(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})
}
