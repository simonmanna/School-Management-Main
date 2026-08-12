import { Module } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { PartnerCategoryService } from './partner-category.service';
import { PartnerCategoryController } from './partner-category.controller';

@Module({
  controllers: [PartnerController, ContactController, AddressController, PartnerCategoryController],
  providers: [PartnerService, ContactService, AddressService, PartnerCategoryService],
  exports: [PartnerService, ContactService, AddressService, PartnerCategoryService],
})
export class PartnerModule {}
