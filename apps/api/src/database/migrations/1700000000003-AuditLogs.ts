import { MigrationInterface, QueryRunner } from 'typeorm';
import { Table } from 'typeorm/schema-builder/table/Table.js';
import { TableIndex } from 'typeorm/schema-builder/table/TableIndex.js';
import { TableForeignKey } from 'typeorm/schema-builder/table/TableForeignKey.js';

export class AuditLogs1700000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // audit_logs table
    await queryRunner.createTable(
      new Table({
        name: 'audit_logs',
        columns: [
          {
            name: 'id',
            type: 'bigserial',
            isPrimary: true,
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'actor_user_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'entity_type',
            type: 'varchar',
            length: '40',
            isNullable: false,
          },
          {
            name: 'entity_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '60',
            isNullable: false,
          },
          {
            name: 'before',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'after',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'request_id',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'ip',
            type: 'inet',
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

    // Index on organization_id
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    // Composite index for entity history queries
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_org_entity_created',
        columnNames: ['organization_id', 'entity_type', 'entity_id', 'created_at'],
      }),
    );

    // Index on actor_user_id
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_actor_user_id',
        columnNames: ['actor_user_id'],
      }),
    );

    // Index on action
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_action',
        columnNames: ['action'],
      }),
    );

    // Index on request_id for correlation
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_request_id',
        columnNames: ['request_id'],
      }),
    );

    // Index on created_at for time-range queries
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'IDX_audit_logs_created_at',
        columnNames: ['created_at'],
      }),
    );

    // FK audit_logs -> organizations
    await queryRunner.createForeignKey(
      'audit_logs',
      new TableForeignKey({
        name: 'FK_audit_logs_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // FK audit_logs -> users (actor_user_id)
    await queryRunner.createForeignKey(
      'audit_logs',
      new TableForeignKey({
        name: 'FK_audit_logs_actor_user',
        columnNames: ['actor_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // ============================================
    // IMMUTABILITY TRIGGERS (doble protección a nivel BD)
    // ============================================

    // Function that raises exception on any modification attempt
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs es inmutable (% no permitido)', TG_OP;
      END; $$ LANGUAGE plpgsql;
    `);

    // Trigger BEFORE UPDATE OR DELETE
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_no_update_delete
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
    `);

    // Trigger BEFORE TRUNCATE (requires FOR EACH STATEMENT)
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_no_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
    `);

    // Optional: Revoke UPDATE/DELETE/TRUNCATE from application role
    // This is commented out as the role name depends on your setup
    // REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM your_app_role;
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop triggers first
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_logs_no_update_delete ON audit_logs;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_immutable();`);

    // Drop table (cascades will handle indexes and FKs)
    await queryRunner.dropTable('audit_logs');
  }
}