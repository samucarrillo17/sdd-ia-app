import { IsString, IsNotEmpty, MaxLength, IsArray, ValidateNested, IsEnum, IsInt, Min, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export enum AiAction {
  RESERVAR = 'RESERVAR',
  REVISAR = 'REVISAR',
  POSTERGAR = 'POSTERGAR',
}

export class AiRecommendationDto {
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(1)
  rank: number;

  @IsEnum(AiAction)
  action: AiAction;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AiResponseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  summary: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiRecommendationDto)
  recommendations: AiRecommendationDto[];
}