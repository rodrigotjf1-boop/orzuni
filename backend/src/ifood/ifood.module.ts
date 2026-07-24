import { Module } from '@nestjs/common';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodCatalogService } from './ifood-catalog.service';
import { IfoodMerchantService } from './ifood-merchant.service';

@Module({
  providers: [IfoodAuthService, IfoodCatalogService, IfoodMerchantService],
  exports: [IfoodAuthService, IfoodCatalogService, IfoodMerchantService],
})
export class IfoodModule {}
