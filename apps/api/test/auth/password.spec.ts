import * as argon2 from 'argon2';

describe('Password hashing', () => {
  const password = 'devpassword123';

  it('should hash and verify password correctly', async () => {
    const hash = await argon2.hash(password);
    const isValid = await argon2.verify(hash, password);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await argon2.hash(password);
    const isValid = await argon2.verify(hash, 'wrongpassword');
    expect(isValid).toBe(false);
  });

  it('should produce different hashes for same password', async () => {
    const hash1 = await argon2.hash(password);
    const hash2 = await argon2.hash(password);
    expect(hash1).not.toBe(hash2);
  });
});