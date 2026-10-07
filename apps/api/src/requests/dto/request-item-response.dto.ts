import { Expose } from 'class-transformer';

export class RequestItemResponseDto {
  @Expose()
  id: string;

  @Expose()
  productId: string;

  @Expose()
  quantity: number;

  @Expose()
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
  };
}