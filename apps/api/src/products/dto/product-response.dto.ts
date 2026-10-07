import { Expose } from 'class-transformer';

export class ProductResponseDto {
  @Expose()
  id: string;

  @Expose()
  sku: string;

  @Expose()
  name: string;

  @Expose()
  unit: string;

  @Expose()
  isActive: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}