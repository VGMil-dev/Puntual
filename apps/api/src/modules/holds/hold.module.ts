import { Module } from '@nestjs/common';
import { HoldService } from './hold.service';
import { HoldController } from './hold.controller';

@Module({
  controllers: [HoldController],
  providers: [HoldService],
  exports: [HoldService],
})
export class HoldModule {}
