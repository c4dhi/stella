import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identity: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;
}
