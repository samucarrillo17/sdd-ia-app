import { PartialType } from '@nestjs/swagger';
import { CreateRequestDto } from './create-request.dto.js';

export class UpdateRequestDto extends PartialType(CreateRequestDto) {}