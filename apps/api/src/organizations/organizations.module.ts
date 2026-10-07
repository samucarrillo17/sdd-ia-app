import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsService } from './organizations.service.js';
import { Organization } from './organization.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Organization])],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}