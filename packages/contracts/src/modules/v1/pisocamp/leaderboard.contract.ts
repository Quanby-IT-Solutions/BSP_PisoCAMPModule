import { oc } from "@orpc/contract"

import {
	LeaderboardInputSchema,
	LeaderboardSchema,
	UpdateLeaderboardAliasInputSchema,
} from "./leaderboard.schema.js"

const tags = ["Piso CAMP"]

export const pisoCampLeaderboardContract = {
	get: oc
		.route({
			method: "GET",
			path: "/pisocamp/leaderboard",
			summary: "The leaderboard for a period, by alias",
			tags,
		})
		.input(LeaderboardInputSchema)
		.output(LeaderboardSchema),
	setAlias: oc
		.route({
			method: "PUT",
			path: "/pisocamp/leaderboard/alias",
			summary: "Choose the name shown on the leaderboard",
			tags,
		})
		.input(UpdateLeaderboardAliasInputSchema)
		.output(UpdateLeaderboardAliasInputSchema),
}
