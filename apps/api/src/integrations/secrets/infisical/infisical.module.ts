import { Global, Module } from '@nestjs/common';
import { SECRET_STORE_PORT } from '../secret-store.port';
import { InfisicalAdapter } from './infisical.adapter';

@Global()
@Module({
  providers: [
    InfisicalAdapter,
    {
      provide: SECRET_STORE_PORT,
      useExisting: InfisicalAdapter,
    },
  ],
  exports: [SECRET_STORE_PORT, InfisicalAdapter],
})
export class InfisicalModule {}
