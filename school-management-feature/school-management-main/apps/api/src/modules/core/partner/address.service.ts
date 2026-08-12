import { Injectable } from '@nestjs/common';
import type { Address } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class AddressService extends BaseCrudService<Address, CreateAddressDto, UpdateAddressDto> {
  protected readonly entityName = 'Address';
  protected readonly searchFields = ['line1', 'city', 'state', 'country'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.address as unknown as CrudDelegate);
  }
}