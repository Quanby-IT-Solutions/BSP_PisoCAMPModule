import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { PushService } from "./push.service"

/**
 * SA-5, the person's own half.
 *
 * Being signed in is the whole of the requirement: a permission here would mean
 * asking an administrator to be allowed to control notifications to your own
 * device.
 */
@Controller()
export class PushController {
	constructor(private readonly push: PushService) {}

	@Implement(v1.pisocamp.push.status)
	status(@Session() session: UserSession) {
		return implement(v1.pisocamp.push.status).handler(() =>
			this.push.status(session.user.id)
		)
	}

	@Implement(v1.pisocamp.push.subscribe)
	subscribe(@Session() session: UserSession) {
		return implement(v1.pisocamp.push.subscribe).handler(({ input }) =>
			this.push.subscribe(input, session.user.id)
		)
	}

	@Implement(v1.pisocamp.push.unsubscribe)
	unsubscribe(@Session() session: UserSession) {
		return implement(v1.pisocamp.push.unsubscribe).handler(() =>
			this.push.unsubscribe(session.user.id)
		)
	}

	@Implement(v1.pisocamp.push.receipt)
	receipt(@Session() session: UserSession) {
		return implement(v1.pisocamp.push.receipt).handler(({ input }) =>
			this.push.recordReceipt(input, session.user.id)
		)
	}
}

/**
 * SA-5's administrative half.
 *
 * Sending is `admin.notifications.send`; reading the rates is the same
 * reporting permission as every other dashboard, because a figure about
 * notifications is still a figure.
 */
@Controller()
export class NotificationsController {
	constructor(private readonly push: PushService) {}

	@RequirePermissions("admin.notifications.send")
	@Implement(v1.pisocamp.admin.notifications.send)
	send(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.notifications.send).handler(({ input }) =>
			this.push.send(input, session.user.id)
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.admin.notifications.metrics)
	metrics() {
		return implement(v1.pisocamp.admin.notifications.metrics).handler(({ input }) =>
			this.push.metrics(input)
		)
	}
}
