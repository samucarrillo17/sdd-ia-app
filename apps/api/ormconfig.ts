import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Organization } from './src/organizations/organization.entity.js';
import { User } from './src/users/user.entity.js';
import { Session } from './src/auth/session.entity.js';

config();

const isTest = process.env.NODE_ENV === 'test';
const databaseUrl = isTest
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  entities: [Organization, User, Session],
  migrations: ['src/database/migrations/*.ts'],
  migrationsTableName: 'migrations',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});