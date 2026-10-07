import { IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class RequestItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  @Type(() => Number)
  quantity: number;
}