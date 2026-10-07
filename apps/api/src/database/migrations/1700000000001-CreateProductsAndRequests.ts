import { MigrationInterface, QueryRunner } from 'typeorm';
import { Table } from 'typeorm/schema-builder/table/Table.js';
import { TableIndex } from 'typeorm/schema-builder/table/TableIndex.js';
import { TableForeignKey } from 'typeorm/schema-builder/table/TableForeignKey.js';
import { TableUnique } from 'typeorm/schema-builder/table/TableUnique.js';
import { TableCheck } from 'typeorm/schema-builder/table/TableCheck.js';

export class CreateProductsAndRequests1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // products table
    await queryRunner.createTable(
      new Table({
        name: 'products',
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
            name: 'sku',
            type: 'varchar',
            length: '40',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '160',
            isNullable: false,
          },
          {
            name: 'unit',
            type: 'varchar',
            length: '20',
            isNullable: false,
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

    // Unique constraint on (organization_id, sku)
    await queryRunner.createUniqueConstraint(
      'products',
      new TableUnique({
        name: 'UQ_products_organization_sku',
        columnNames: ['organization_id', 'sku'],
      }),
    );

    // Index on organization_id
    await queryRunner.createIndex(
      'products',
      new TableIndex({
        name: 'IDX_products_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    // FK products -> organizations
    await queryRunner.createForeignKey(
      'products',
      new TableForeignKey({
        name: 'FK_products_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // requests table
    await queryRunner.createTable(
      new Table({
        name: 'requests',
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
            name: 'code',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'requester_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['BORRADOR', 'ENVIADA', 'RESERVADA', 'DESPACHADA', 'ENTREGADA', 'CANCELADA'],
            default: "'BORRADOR'",
          },
          {
            name: 'priority',
            type: 'enum',
            enum: ['ALTA', 'MEDIA', 'BAJA'],
            default: "'MEDIA'",
          },
          {
            name: 'needed_by',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'notes',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'submitted_at',
            type: 'timestamptz',
            isNullable: true,
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

    // Unique constraint on (organization_id, code)
    await queryRunner.createUniqueConstraint(
      'requests',
      new TableUnique({
        name: 'UQ_requests_organization_code',
        columnNames: ['organization_id', 'code'],
      }),
    );

    // Indexes
    await queryRunner.createIndex(
      'requests',
      new TableIndex({
        name: 'IDX_requests_organization_id',
        columnNames: ['organization_id'],
      }),
    );

    await queryRunner.createIndex(
      'requests',
      new TableIndex({
        name: 'IDX_requests_organization_status',
        columnNames: ['organization_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'requests',
      new TableIndex({
        name: 'IDX_requests_organization_requester',
        columnNames: ['organization_id', 'requester_id'],
      }),
    );

    await queryRunner.createIndex(
      'requests',
      new TableIndex({
        name: 'IDX_requests_organization_created_at_desc',
        columnNames: ['organization_id', 'created_at'],
      }),
    );

    // FK requests -> organizations
    await queryRunner.createForeignKey(
      'requests',
      new TableForeignKey({
        name: 'FK_requests_organization',
        columnNames: ['organization_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // FK requests -> users (requester)
    await queryRunner.createForeignKey(
      'requests',
      new TableForeignKey({
        name: 'FK_requests_requester',
        columnNames: ['requester_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // request_items table
    await queryRunner.createTable(
      new Table({
        name: 'request_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'request_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'product_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'quantity',
            type: 'int',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Unique constraint on (request_id, product_id) - no duplicate SKU in same request
    await queryRunner.createUniqueConstraint(
      'request_items',
      new TableUnique({
        name: 'UQ_request_items_request_product',
        columnNames: ['request_id', 'product_id'],
      }),
    );

    // Check constraint: quantity > 0
    await queryRunner.createCheckConstraint(
      'request_items',
      new TableCheck({
        name: 'CHK_request_items_quantity_positive',
        expression: 'quantity > 0',
      }),
    );

    // FK request_items -> requests (CASCADE)
    await queryRunner.createForeignKey(
      'request_items',
      new TableForeignKey({
        name: 'FK_request_items_request',
        columnNames: ['request_id'],
        referencedTableName: 'requests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // FK request_items -> products
    await queryRunner.createForeignKey(
      'request_items',
      new TableForeignKey({
        name: 'FK_request_items_product',
        columnNames: ['product_id'],
        referencedTableName: 'products',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // Index on request_id for faster lookups
    await queryRunner.createIndex(
      'request_items',
      new TableIndex({
        name: 'IDX_request_items_request_id',
        columnNames: ['request_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('request_items');
    await queryRunner.dropTable('requests');
    await queryRunner.dropTable('products');
  }
}