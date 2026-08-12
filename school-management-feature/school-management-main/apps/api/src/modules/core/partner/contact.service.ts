import { Injectable } from '@nestjs/common';
import type { Contact } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService extends BaseCrudService<Contact, CreateContactDto, UpdateContactDto> {
  protected readonly entityName = 'Contact';
  protected readonly searchFields = ['firstName', 'lastName', 'email', 'phone'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.contact as unknown as CrudDelegate);
  }
}