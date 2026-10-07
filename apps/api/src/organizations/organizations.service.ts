import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './organization.entity.js';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
  ) {}

  async findByCode(code: string): Promise<Organization | null> {
    return this.organizationRepository.findOne({ where: { code } });
  }

  async findAll(): Promise<Organization[]> {
    return this.organizationRepository.find();
  }

  async findById(id: string): Promise<Organization | null> {
    return this.organizationRepository.findOne({ where: { id } });
  }
}