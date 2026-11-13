import { IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class DevelopmentLoginDto {
  @IsString() @MinLength(1) @MaxLength(128) @Matches(/^[A-Za-z0-9_.-]+$/) subject!: string;
}
export class RefreshDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/) refreshToken!: string;
}
export class PairingStartDto {
  @ValidateIf(o => o.installationId !== undefined || o.installationSecret !== undefined) @IsUUID() installationId?: string;
  @ValidateIf(o => o.installationId !== undefined || o.installationSecret !== undefined) @Matches(/^[A-Za-z0-9_-]{43}$/) installationSecret?: string;
}
export class PairingApproveDto {
  @Matches(/^[A-Fa-f0-9]{12}$/) userCode!: string;
}
export class PairingExchangeDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/) deviceCode!: string;
}
