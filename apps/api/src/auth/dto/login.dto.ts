import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'solicitante@org-a.test' })
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiProperty({ example: 'devpassword123' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}