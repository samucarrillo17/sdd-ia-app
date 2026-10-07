import { MigrationInterface, QueryRunner } from 'typeorm';
import { Table } from 'typeorm/schema-builder/table/Table.js';
import { TableIndex } from 'typeorm/schema-builder/table/TableIndex.js';
import { TableForeignKey } from 'typeorm/schema-builder/table/TableForeignKey.js';
import { TableUnique } from 'typeorm/schema-builder/table/TableUnique.js';
import { TableCheck } from 'typeorm/schema-builder/table/TableCheck.js';

export class InventoryAndIdempotency1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // inventory table
    await queryRunner.createTable(
      new Table({
        name: 'inventory',
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
            name: 'product_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'on_hand',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'reserved',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'version',
            type: 'int',
            default: 0,
            isNullable: false,
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

    // Unique constraint on (organization_id, product_id)
    await queryRunner.createUniqueConstraint(
      'inventory',
      new TableUnique({
        name: 'UQ_inventory_organization_product',
        columnNames: ['organization_id', 'product_id'],
      }),
    );

    // Index on organization_id
    await queryRunner.createIndex(
      'inventory',
      new TableIndex({
        name: 'IDX_inventory_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    // FK inventory -> organizations
    await queryRunner.createForeignKey(
      'inventory',
      new TableForeignKey({
        name: 'FK_inventory_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // FK inventory -> products
    await queryRunner.createForeignKey(
      'inventory',
      new TableForeignKey({
        name: 'FK_inventory_product',
        columnNames: ['product_id'],
        referencedTableName: 'products',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // CHECK constraints for inventory (stock protection)
    await queryRunner.createCheckConstraint(
      'inventory',
      new TableCheck({
        name: 'CHK_inventory_on_hand_nonneg',
        expression: 'on_hand >= 0',
      }),
    );

    await queryRunner.createCheckConstraint(
      'inventory',
      new TableCheck({
        name: 'CHK_inventory_reserved_nonneg',
        expression: 'reserved >= 0',
      }),
    );

    await queryRunner.createCheckConstraint(
      'inventory',
      new TableCheck({
        name: 'CHK_inventory_reserved_le_on_hand',
        expression: 'reserved <= on_hand',
      }),
    );

    // inventory_movements table (kardex)
    await queryRunner.createTable(
      new Table({
        name: 'inventory_movements',
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
            name: 'product_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'request_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'type',
            type: 'enum',
            enum: ['RESERVA', 'LIBERACION', 'DESPACHO', 'AJUSTE'],
            isNullable: false,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'created_by',
            type: 'uuid',
            isNullable: false,
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

    // Indexes for inventory_movements
    await queryRunner.createIndex(
      'inventory_movements',
      new TableIndex({
        name: 'IDX_inventory_movements_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    await queryRunner.createIndex(
      'inventory_movements',
      new TableIndex({
        name: 'IDX_inventory_movements_organization_product',
        columnNames: ['organization_id', 'product_id'],
      }),
    );

    await queryRunner.createIndex(
      'inventory_movements',
      new TableIndex({
        name: 'IDX_inventory_movements_request_id',
        columnNames: ['request_id'],
      }),
    );

    await queryRunner.createIndex(
      'inventory_movements',
      new TableIndex({
        name: 'IDX_inventory_movements_created_at',
        columnNames: ['created_at'],
      }),
    );

    // FK inventory_movements -> organizations
    await queryRunner.createForeignKey(
      'inventory_movements',
      new TableForeignKey({
        name: 'FK_inventory_movements_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // FK inventory_movements -> products
    await queryRunner.createForeignKey(
      'inventory_movements',
      new TableForeignKey({
        name: 'FK_inventory_movements_product',
        columnNames: ['product_id'],
        referencedTableName: 'products',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // FK inventory_movements -> requests (SET NULL)
    await queryRunner.createForeignKey(
      'inventory_movements',
      new TableForeignKey({
        name: 'FK_inventory_movements_request',
        columnNames: ['request_id'],
        referencedTableName: 'requests',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // FK inventory_movements -> users (created_by)
    await queryRunner.createForeignKey(
      'inventory_movements',
      new TableForeignKey({
        name: 'FK_inventory_movements_created_by',
        columnNames: ['created_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // CHECK constraint: quantity > 0
    await queryRunner.createCheckConstraint(
      'inventory_movements',
      new TableCheck({
        name: 'CHK_inventory_movements_quantity_positive',
        expression: 'quantity > 0',
      }),
    );

    // idempotency_keys table
    await queryRunner.createTable(
      new Table({
        name: 'idempotency_keys',
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
            name: 'key',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'endpoint',
            type: 'varchar',
            length: '120',
            isNullable: false,
          },
          {
            name: 'request_hash',
            type: 'char',
            length: '64',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['IN_PROGRESS', 'COMPLETED'],
            default: "'IN_PROGRESS'",
            isNullable: false,
          },
          {
            name: 'response_status',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'response_body',
            type: 'jsonb',
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

    // Unique constraint on (organization_id, endpoint, key)
    await queryRunner.createUniqueConstraint(
      'idempotency_keys',
      new TableUnique({
        name: 'UQ_idempotency_keys_org_endpoint_key',
        columnNames: ['organization_id', 'endpoint', 'key'],
      }),
    );

    // Indexes
    await queryRunner.createIndex(
      'idempotency_keys',
      new TableIndex({
        name: 'IDX_idempotency_keys_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    await queryRunner.createIndex(
      'idempotency_keys',
      new TableIndex({
        name: 'IDX_idempotency_keys_created_at',
        columnNames: ['created_at'],
      }),
    );

    // FK idempotency_keys -> organizations
    await queryRunner.createForeignKey(
      'idempotency_keys',
      new TableForeignKey({
        name: 'FK_idempotency_keys_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('idempotency_keys');
    await queryRunner.dropTable('inventory_movements');
    await queryRunner.dropTable('inventory');
  }
}