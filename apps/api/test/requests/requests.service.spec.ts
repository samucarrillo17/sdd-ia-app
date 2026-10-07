import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { RequestsService } from '../../src/requests/requests.service.js';
import { Product } from '../../src/products/product.entity.js';
import { Request } from '../../src/requests/entities/request.entity.js';
import { RequestItem } from '../../src/requests/entities/request-item.entity.js';
import { User } from '../../src/users/user.entity.js';
import { RequestStatus } from '../../src/requests/enums/request-status.enum.js';
import { Priority } from '../../src/requests/enums/priority.enum.js';
import { Role } from '../../src/users/role.enum.js';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from '../../src/inventory/inventory.service.js';
import { IdempotencyService } from '../../src/idempotency/idempotency.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockUser = {
  id: 'user-1',
  organizationId: 'org-1',
  role: Role.SOLICITANTE,
};

const mockProduct = {
  id: 'product-1',
  organizationId: 'org-1',
  sku: 'SKU-001',
  name: 'Producto Test',
  unit: 'und',
  isActive: true,
};

const mockRequest = {
  id: 'request-1',
  organizationId: 'org-1',
  code: 'SOL-000001',
  requesterId: 'user-1',
  status: RequestStatus.BORRADOR,
  priority: Priority.MEDIA,
  neededBy: new Date(Date.now() + 86400000), // Tomorrow
  notes: null,
  submittedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
};

function getFutureDate(days = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

describe('RequestsService', () => {
  let service: RequestsService;
  let requestRepository: Repository<Request>;
  let requestItemRepository: Repository<RequestItem>;
  let productRepository: Repository<Product>;
  let userRepository: Repository<User>;
  let dataSource: DataSource;
  let inventoryService: InventoryService;
  let idempotencyService: IdempotencyService;
  let auditService: AuditService;

  beforeEach(async () => {
    const mockRepository = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
        getMany: vi.fn().mockResolvedValue([]),
        setLock: vi.fn().mockReturnThis(),
      })),
    };

    const mockManager = {
      findOne: mockRepository.findOne,
      find: mockRepository.find,
      save: mockRepository.save,
      create: mockRepository.create,
      delete: mockRepository.delete,
      createQueryBuilder: mockRepository.createQueryBuilder,
    };

    const mockDataSource = {
      transaction: vi.fn((callback) => callback(mockManager as any)),
    };

    const mockInventoryService = {
      getRequestItemsForInventory: vi.fn().mockResolvedValue([]),
      reserveItems: vi.fn().mockResolvedValue(undefined),
      dispatchItems: vi.fn().mockResolvedValue(undefined),
      releaseItems: vi.fn().mockResolvedValue(undefined),
      ensureInventoryExists: vi.fn().mockResolvedValue(undefined),
      getStock: vi.fn().mockResolvedValue([]),
      getKardex: vi.fn().mockResolvedValue([]),
      adjustStock: vi.fn().mockResolvedValue(undefined),
    };

    const mockAuditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    const mockIdempotencyService = {
      runIdempotent: vi.fn().mockImplementation(async ({ fn }) => {
        const mockManager = {
          findOne: mockRepository.findOne,
          find: mockRepository.find,
          save: mockRepository.save,
          create: mockRepository.create,
          delete: mockRepository.delete,
          createQueryBuilder: mockRepository.createQueryBuilder,
        };
        return fn(mockManager as any);
      }),
      generateRequestHash: vi.fn().mockReturnValue('mock-hash'),
      cleanupExpiredKeys: vi.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getRepositoryToken(Request),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(RequestItem),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Product),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
    requestRepository = module.get(getRepositoryToken(Request));
    requestItemRepository = module.get(getRepositoryToken(RequestItem));
    productRepository = module.get(getRepositoryToken(Product));
    userRepository = module.get(getRepositoryToken(User));
    dataSource = module.get(DataSource);
    inventoryService = module.get(InventoryService);
    idempotencyService = module.get(IdempotencyService);
    auditService = module.get(AuditService);
  });

  describe('create - validation', () => {
    it('should throw BadRequestException when items exceed 10', async () => {
      const dto = {
        priority: Priority.MEDIA,
        neededBy: getFutureDate(),
        items: Array(11).fill({ productId: 'product-1', quantity: 1 }),
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(mockUser),
        find: vi.fn(),
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when duplicate products', async () => {
      const dto = {
        priority: Priority.MEDIA,
        neededBy: getFutureDate(),
        items: [
          { productId: 'product-1', quantity: 1 },
          { productId: 'product-1', quantity: 2 },
        ],
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(mockUser),
        find: vi.fn(),
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when neededBy is in the past', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dto = {
        priority: Priority.MEDIA,
        neededBy: yesterday.toISOString().split('T')[0],
        items: [{ productId: 'product-1', quantity: 1 }],
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(mockUser),
        find: vi.fn(),
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when product does not belong to organization', async () => {
      const dto = {
        priority: Priority.MEDIA,
        neededBy: getFutureDate(),
        items: [{ productId: 'product-1', quantity: 1 }],
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(mockUser),
        find: vi.fn().mockResolvedValue([]), // No products found for org
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user not found', async () => {
      const dto = {
        priority: Priority.MEDIA,
        neededBy: getFutureDate(),
        items: [{ productId: 'product-1', quantity: 1 }],
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn(),
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should return request when user is owner', async () => {
      const requestWithItems = {
        ...mockRequest,
        items: [{ id: 'item-1', productId: 'product-1', quantity: 5, product: mockProduct }],
        requester: mockUser,
      };

      requestRepository.findOne.mockResolvedValue(requestWithItems as any);

      const result = await service.findOne('request-1', {
        id: 'user-1',
        organizationId: 'org-1',
        role: Role.SOLICITANTE,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('request-1');
    });

    it('should throw NotFoundException when SOLICITANTE tries to access another user request', async () => {
      const requestWithItems = {
        ...mockRequest,
        requesterId: 'other-user',
        items: [],
        requester: { ...mockUser, id: 'other-user' },
      };

      requestRepository.findOne.mockResolvedValue(requestWithItems as any);

      await expect(service.findOne('request-1', {
        id: 'user-1',
        organizationId: 'org-1',
        role: Role.SOLICITANTE,
      })).rejects.toThrow(NotFoundException);
    });

    it('should allow COORDINADOR to access any request in org', async () => {
      const requestWithItems = {
        ...mockRequest,
        requesterId: 'other-user',
        items: [],
        requester: { ...mockUser, id: 'other-user' },
      };

      requestRepository.findOne.mockResolvedValue(requestWithItems as any);

      const result = await service.findOne('request-1', {
        id: 'coordinator-1',
        organizationId: 'org-1',
        role: Role.COORDINADOR,
      });

      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    it('should throw ForbiddenException when user is not owner', async () => {
      const existingRequest = { ...mockRequest, requesterId: 'other-user', items: [] };
      const dto = { priority: Priority.ALTA, neededBy: getFutureDate(), items: [] };

      requestRepository.findOne.mockResolvedValue(existingRequest as any);

      await expect(service.update('request-1', 'user-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when request is not BORRADOR', async () => {
      const existingRequest = { ...mockRequest, status: RequestStatus.ENVIADA, items: [] };
      const dto = { priority: Priority.ALTA, neededBy: getFutureDate(), items: [] };

      requestRepository.findOne.mockResolvedValue(existingRequest as any);

      await expect(service.update('request-1', 'user-1', dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('should delete request when in BORRADOR and user is owner', async () => {
      const existingRequest = { ...mockRequest, items: [] };
      
      const mockManager = {
        findOne: vi.fn().mockResolvedValue(existingRequest),
        find: vi.fn(),
        save: vi.fn(),
        create: vi.fn(),
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: vi.fn(() => ({
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          take: vi.fn().mockReturnThis(),
          getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
          getMany: vi.fn().mockResolvedValue([]),
          setLock: vi.fn().mockReturnThis(),
        })),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await service.delete('request-1', 'user-1');

      expect(mockManager.delete).toHaveBeenCalledWith(Request, { id: 'request-1', organizationId: 'org-1' });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const existingRequest = { ...mockRequest, requesterId: 'other-user' };
      requestRepository.findOne.mockResolvedValue(existingRequest as any);

      await expect(service.delete('request-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when request is not BORRADOR', async () => {
      const existingRequest = { ...mockRequest, status: RequestStatus.ENVIADA };
      requestRepository.findOne.mockResolvedValue(existingRequest as any);

      await expect(service.delete('request-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('submit', () => {
    it('should submit request and change status to ENVIADA', async () => {
      const existingRequest = {
        ...mockRequest,
        status: RequestStatus.BORRADOR,
        neededBy: new Date(Date.now() + 86400000), // Tomorrow
        items: [{ id: 'item-1', productId: 'product-1', quantity: 5, product: mockProduct }],
      };

      const mockManager = {
        findOne: vi.fn().mockResolvedValue(existingRequest),
        find: vi.fn().mockResolvedValue([mockProduct]),
        save: vi.fn().mockResolvedValue({ ...existingRequest, status: RequestStatus.ENVIADA, submittedAt: new Date() }),
      };

      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      const result = await service.submit('request-1', 'user-1');

      expect(result.status).toBe(RequestStatus.ENVIADA);
      expect(result.submittedAt).toBeDefined();
    });

    it('should throw ConflictException when request is not BORRADOR', async () => {
      const existingRequest = { ...mockRequest, status: RequestStatus.ENVIADA, items: [] };
      const mockManager = { findOne: vi.fn().mockResolvedValue(existingRequest) };
      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.submit('request-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when request has no items', async () => {
      const existingRequest = { ...mockRequest, status: RequestStatus.BORRADOR, items: [] };
      const mockManager = { findOne: vi.fn().mockResolvedValue(existingRequest) };
      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.submit('request-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const existingRequest = { ...mockRequest, status: RequestStatus.BORRADOR, requesterId: 'other-user', items: [{}] };
      const mockManager = { findOne: vi.fn().mockResolvedValue(existingRequest) };
      dataSource.transaction.mockImplementation(async (callback) => callback(mockManager as any));

      await expect(service.submit('request-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });
});