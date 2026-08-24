import { Module } from "@nestjs/common"

import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

@Module({
	controllers: [PisoCampController],
	providers: [PisoCampService],
})
export class PisoCampModule {}
