import { IsOptional, IsArray, ArrayMaxSize, ArrayUnique, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSummaryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  requestIds?: string[];
}