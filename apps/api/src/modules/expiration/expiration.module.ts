import { Module } from '@nestjs/common';
import { ExpirationService } from './expiration.service';

@Module({
  providers: [ExpirationService],
  exports: [ExpirationService],
})
export class ExpirationModule {}
