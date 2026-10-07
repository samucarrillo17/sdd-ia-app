import { DataSource, DataSourceOptions } from 'typeorm';
import * as argon2 from 'argon2';
import { Organization } from '../../organizations/organization.entity.js';
import { User } from '../../users/user.entity.js';
import { Role } from '../../users/role.enum.js';
import { Product } from '../../products/product.entity.js';
import { Inventory } from '../../inventory/inventory.entity.js';
import { config } from 'dotenv';

config();

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'devpassword123';

const organizationsData = [
  { code: 'ORG-A', name: 'Organización A' },
  { code: 'ORG-B', name: 'Organización B' },
];

const usersData = [
  // ORG-A users
  { email: 'solicitante@org-a.test', role: Role.SOLICITANTE, fullName: 'Solicitante Org A', orgCode: 'ORG-A' },
  { email: 'coordinador@org-a.test', role: Role.COORDINADOR, fullName: 'Coordinador Org A', orgCode: 'ORG-A' },
  { email: 'bodega@org-a.test', role: Role.BODEGA, fullName: 'Bodega Org A', orgCode: 'ORG-A' },
  { email: 'auditor@org-a.test', role: Role.AUDITOR, fullName: 'Auditor Org A', orgCode: 'ORG-A' },
  // ORG-B users
  { email: 'solicitante@org-b.test', role: Role.SOLICITANTE, fullName: 'Solicitante Org B', orgCode: 'ORG-B' },
  { email: 'coordinador@org-b.test', role: Role.COORDINADOR, fullName: 'Coordinador Org B', orgCode: 'ORG-B' },
  { email: 'bodega@org-b.test', role: Role.BODEGA, fullName: 'Bodega Org B', orgCode: 'ORG-B' },
  { email: 'auditor@org-b.test', role: Role.AUDITOR, fullName: 'Auditor Org B', orgCode: 'ORG-B' },
];

// Products per organization (10+ each, some with low stock for testing)
const productsData = {
  'ORG-A': [
    { sku: 'SKU-A-001', name: 'Laptop Dell Latitude 5520', unit: 'und' },
    { sku: 'SKU-A-002', name: 'Mouse Logitech MX Master 3', unit: 'und' },
    { sku: 'SKU-A-003', name: 'Teclado Mecánico Keychron K2', unit: 'und' },
    { sku: 'SKU-A-004', name: 'Monitor LG 27" 4K', unit: 'und' },
    { sku: 'SKU-A-005', name: 'Disco SSD Samsung 1TB', unit: 'und' },
    { sku: 'SKU-A-006', name: 'RAM DDR4 32GB (2x16GB)', unit: 'kit' },
    { sku: 'SKU-A-007', name: 'Docking Station USB-C', unit: 'und' },
    { sku: 'SKU-A-008', name: 'Cargador USB-C 65W', unit: 'und' },
    { sku: 'SKU-A-009', name: 'Cable HDMI 2m', unit: 'und' },
    { sku: 'SKU-A-010', name: 'Webcam Logitech C920', unit: 'und' },
    { sku: 'SKU-A-011', name: 'Auriculares Sony WH-1000XM4', unit: 'und' },
    { sku: 'SKU-A-012', name: 'Tableta Wacom Intuos', unit: 'und' },
  ],
  'ORG-B': [
    { sku: 'SKU-B-001', name: 'Silla Ergonómica Herman Miller', unit: 'und' },
    { sku: 'SKU-B-002', name: 'Escritorio Regulable Altura', unit: 'und' },
    { sku: 'SKU-B-003', name: 'Lámpara LED Escritorio', unit: 'und' },
    { sku: 'SKU-B-004', name: 'Alfombrilla Ratón XL', unit: 'und' },
    { sku: 'SKU-B-005', name: 'Soporte Monitor Brazo', unit: 'und' },
    { sku: 'SKU-B-006', name: 'Organizador Cables', unit: 'pack' },
    { sku: 'SKU-B-007', name: 'Hub USB 7 Puertos', unit: 'und' },
    { sku: 'SKU-B-008', name: 'Alfombra Silla Oficina', unit: 'und' },
    { sku: 'SKU-B-009', name: 'Reposamuñecas Gel', unit: 'par' },
    { sku: 'SKU-B-010', name: 'Filtro Privacidad Monitor', unit: 'und' },
    { sku: 'SKU-B-011', name: 'Mini Nevera Escritorio', unit: 'und' },
    { sku: 'SKU-B-012', name: 'Purificador Aire Pequeño', unit: 'und' },
  ],
};

// Initial stock per product (some LOW for testing INSUFFICIENT_STOCK)
// Format: { sku: onHand }
// Low stock items: ≤ 5 units
const initialStock = {
  'ORG-A': {
    'SKU-A-001': 10,   // Normal
    'SKU-A-002': 25,   // Normal
    'SKU-A-003': 15,   // Normal
    'SKU-A-004': 8,    // Normal
    'SKU-A-005': 30,   // Normal
    'SKU-A-006': 12,   // Normal
    'SKU-A-007': 20,   // Normal
    'SKU-A-008': 5,    // LOW - para test stock insuficiente
    'SKU-A-009': 50,   // Normal
    'SKU-A-010': 3,    // LOW - para test stock insuficiente
    'SKU-A-011': 7,    // Normal
    'SKU-A-012': 2,    // LOW - para test stock insuficiente
  },
  'ORG-B': {
    'SKU-B-001': 4,    // LOW - para test stock insuficiente
    'SKU-B-002': 6,    // Normal
    'SKU-B-003': 15,   // Normal
    'SKU-B-004': 40,   // Normal
    'SKU-B-005': 10,   // Normal
    'SKU-B-006': 3,    // LOW - para test stock insuficiente
    'SKU-B-007': 12,   // Normal
    'SKU-B-008': 8,    // Normal
    'SKU-B-009': 25,   // Normal
    'SKU-B-010': 2,    // LOW - para test stock insuficiente
    'SKU-B-011': 5,    // LOW - para test stock insuficiente
    'SKU-B-012': 7,    // Normal
  },
};

async function seed() {
  const isTest = process.env.NODE_ENV === 'test';
  const databaseUrl = isTest
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      isTest
        ? 'TEST_DATABASE_URL no está configurada'
        : 'DATABASE_URL no está configurada',
    );
  }

  const dataSourceOptions: DataSourceOptions = {
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    logging: false,
    entities: [Organization, User, Product, Inventory],
    migrations: [],
    migrationsTableName: 'migrations',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };

  const dataSource = new DataSource(dataSourceOptions);

  await dataSource.initialize();

  try {
    const orgRepo = dataSource.getRepository(Organization);
    const userRepo = dataSource.getRepository(User);

    const passwordHash = await argon2.hash(SEED_PASSWORD);

    // Create organizations
    for (const orgData of organizationsData) {
      let org = await orgRepo.findOne({ where: { code: orgData.code } });
      if (!org) {
        org = orgRepo.create(orgData);
        await orgRepo.save(org);
        console.log(`✓ Organización creada: ${orgData.code}`);
      } else {
        console.log(`- Organización ya existe: ${orgData.code}`);
      }
    }

    // Create users
    for (const userData of usersData) {
      const org = await orgRepo.findOne({ where: { code: userData.orgCode } });
      if (!org) {
        console.error(`Organización no encontrada: ${userData.orgCode}`);
        continue;
      }

      let user = await userRepo.findOne({ where: { email: userData.email } });
      if (!user) {
        user = userRepo.create({
          email: userData.email,
          passwordHash,
          fullName: userData.fullName,
          role: userData.role,
          organizationId: org.id,
          isActive: true,
        });
        await userRepo.save(user);
        console.log(`✓ Usuario creado: ${userData.email} (${userData.role})`);
      } else {
        console.log(`- Usuario ya existe: ${userData.email}`);
      }
    }

    // Create products and inventory
    const productRepo = dataSource.getRepository(Product);
    const inventoryRepo = dataSource.getRepository(Inventory);

    for (const orgCode of ['ORG-A', 'ORG-B'] as const) {
      const org = await orgRepo.findOne({ where: { code: orgCode } });
      if (!org) {
        console.error(`Organización no encontrada: ${orgCode}`);
        continue;
      }

      const orgProducts = productsData[orgCode];
      const orgStock = initialStock[orgCode];

      for (const productData of orgProducts) {
        let product = await productRepo.findOne({ where: { sku: productData.sku, organizationId: org.id } });
        if (!product) {
          product = productRepo.create({
            ...productData,
            organizationId: org.id,
            isActive: true,
          });
          await productRepo.save(product);
          console.log(`✓ Producto creado: ${productData.sku} (${orgCode})`);
        } else {
          console.log(`- Producto ya existe: ${productData.sku} (${orgCode})`);
        }

        // Create/update inventory entry
        const onHand = (orgStock as Record<string, number>)[productData.sku] ?? 0;
        let inventory = await inventoryRepo.findOne({ where: { productId: product.id, organizationId: org.id } });
        if (!inventory) {
          inventory = inventoryRepo.create({
            organizationId: org.id,
            productId: product.id,
            onHand,
            reserved: 0,
          });
          await inventoryRepo.save(inventory);
          console.log(`  → Inventario: ${productData.sku} = ${onHand} unidades`);
        } else {
          // Update on_hand if different (preserve reserved)
          if (inventory.onHand !== onHand) {
            inventory.onHand = onHand;
            await inventoryRepo.save(inventory);
            console.log(`  → Inventario actualizado: ${productData.sku} = ${onHand} unidades`);
          } else {
            console.log(`  → Inventario sin cambios: ${productData.sku} = ${onHand} unidades`);
          }
        }
      }
    }

    console.log('\n✅ Seed completado exitosamente');
    console.log(`   2 organizaciones, 8 usuarios, 24 productos, 24 entradas inventario creados/verificados`);
  } catch (error) {
    console.error('❌ Error en seed:', error);
    throw error;
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});