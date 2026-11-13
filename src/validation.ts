import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

export class ObjectValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type === 'body' && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new BadRequestException();
    return super.transform(value, metadata);
  }
}
