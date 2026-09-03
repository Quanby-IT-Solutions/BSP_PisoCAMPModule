import { Module } from "@nestjs/common"

import { PisoCampProgressController } from "./progress.controller"
import { PisoCampProgressService } from "./progress.service"

@Module({
	controllers: [PisoCampProgressController],
	providers: [PisoCampProgressService],
})
export class PisoCampProgressModule {}
