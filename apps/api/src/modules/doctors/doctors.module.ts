import { Module } from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { SpecialtiesService } from './specialties.service';
import { DoctorsController } from './doctors.controller';
import { SpecialtiesController } from './specialties.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DoctorsController, SpecialtiesController],
  providers: [DoctorsService, SpecialtiesService],
  exports: [DoctorsService, SpecialtiesService],
})
export class DoctorsModule {}
