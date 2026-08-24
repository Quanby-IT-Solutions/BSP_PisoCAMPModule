import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { TodosController } from "./todos.controller"
import { TodosService } from "./todos.service"

@Module({
	imports: [RbacModule],
	controllers: [TodosController],
	providers: [TodosService, IdempotencyInterceptor],
})
export class TodosModule {}
