import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateSessionDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;
}
