import { IsEnum, IsDateString, IsOptional, IsString, MaxLength, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Priority } from '../enums/priority.enum.js';
import { RequestItemDto } from './request-item.dto.js';

export class CreateRequestDto {
  @IsEnum(Priority)
  priority: Priority;

  @IsDateString()
  neededBy: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items: RequestItemDto[];
}