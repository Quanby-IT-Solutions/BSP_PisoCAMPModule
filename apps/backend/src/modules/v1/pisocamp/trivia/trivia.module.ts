import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { TriviaController } from "./trivia.controller"
import { triviaDatabaseProvider, TriviaService } from "./trivia.service"

@Module({
	imports: [RbacModule],
	controllers: [TriviaController],
	providers: [TriviaService, triviaDatabaseProvider],
})
export class TriviaModule {}
