import { IsArray, IsUUID, ArrayMaxSize, ArrayMinSize } from 'class-validator';

export class BatchListenerStatusDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  sessionIds: string[];
}
