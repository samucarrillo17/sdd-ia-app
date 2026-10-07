import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';

@Injectable()
export class UsersService extends TenantScopedService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super();
  }

  async findByOrganization(organizationId: string): Promise<User[]> {
    return this.findByTenant(this.userRepository, organizationId);
  }

  async findOneByOrganization(organizationId: string, id: string): Promise<User | null> {
    return this.findOneByTenant(this.userRepository, organizationId, { where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email }, relations: { organization: true } });
  }
}