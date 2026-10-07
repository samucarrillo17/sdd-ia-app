import { MigrationInterface, QueryRunner } from 'typeorm';
import { Table } from 'typeorm/schema-builder/table/Table.js';
import { TableIndex } from 'typeorm/schema-builder/table/TableIndex.js';
import { TableForeignKey } from 'typeorm/schema-builder/table/TableForeignKey.js';
import { TableUnique } from 'typeorm/schema-builder/table/TableUnique.js';

export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // organizations table
    await queryRunner.createTable(
      new Table({
        name: 'organizations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'code',
            type: 'varchar',
            length: '20',
            isUnique: true,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '120',
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // users table
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'email',
            type: 'varchar',
            length: '160',
            isNullable: false,
          },
          {
            name: 'password_hash',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'full_name',
            type: 'varchar',
            length: '120',
            isNullable: false,
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['SOLICITANTE', 'COORDINADOR', 'BODEGA', 'AUDITOR'],
            default: "'SOLICITANTE'",
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Unique constraint on email per organization (composite)
    await queryRunner.createUniqueConstraint(
      'users',
      new TableUnique({
        name: 'UQ_users_organization_email',
        columnNames: ['organization_id', 'email'],
      }),
    );

    // Index on organization_id
    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    // FK users -> organizations
    await queryRunner.createForeignKey(
      'users',
      new TableForeignKey({
        name: 'FK_users_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // sessions table
    await queryRunner.createTable(
      new Table({
        name: 'sessions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'token_hash',
            type: 'char',
            length: '64',
            isNullable: false,
          },
          {
            name: 'expires_at',
            type: 'timestamptz',
            isNullable: false,
          },
          {
            name: 'revoked_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Unique index on token_hash
    await queryRunner.createIndex(
      'sessions',
      new TableIndex({
        name: 'UQ_sessions_token_hash',
        columnNames: ['token_hash'],
        isUnique: true,
      }),
    );

    // Index on user_id
    await queryRunner.createIndex(
      'sessions',
      new TableIndex({
        name: 'IDX_sessions_user_id',
        columnNames: ['user_id'],
      }),
    );

    // Index on expires_at
    await queryRunner.createIndex(
      'sessions',
      new TableIndex({
        name: 'IDX_sessions_expires_at',
        columnNames: ['expires_at'],
      }),
    );

    // FK sessions -> users
    await queryRunner.createForeignKey(
      'sessions',
      new TableForeignKey({
        name: 'FK_sessions_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sessions');
    await queryRunner.dropTable('users');
    await queryRunner.dropTable('organizations');
  }
}