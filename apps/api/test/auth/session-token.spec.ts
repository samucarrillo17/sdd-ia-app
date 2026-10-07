import { SessionService } from '../../src/auth/session.service';
import * as crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock del repositorio
const mockSessionRepository = {
  create: vi.fn(),
  save: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
};

describe('SessionService', () => {
  let sessionService: SessionService;
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configService = {
      get: vi.fn().mockReturnValue(8), // SESSION_TTL_HOURS = 8
    };
    sessionService = new SessionService(mockSessionRepository as any, configService as any);
    vi.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a base64url encoded token of 32 bytes', () => {
      const token = sessionService.generateToken();
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // base64url de 32 bytes = 43 caracteres (sin padding)
      expect(token.length).toBe(43);
      // Solo caracteres válidos de base64url
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different tokens each time', () => {
      const token1 = sessionService.generateToken();
      const token2 = sessionService.generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken', () => {
    it('should produce consistent SHA-256 hash', () => {
      const token = 'test-token-123';
      const hash1 = sessionService.hashToken(token);
      const hash2 = sessionService.hashToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = sessionService.hashToken('token-1');
      const hash2 = sessionService.hashToken('token-2');
      expect(hash1).not.toBe(hash2);
    });
  });
});