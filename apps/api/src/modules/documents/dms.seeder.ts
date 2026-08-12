/**
 * DMS runtime boot seeder (Phase 1.2/1.5). Upserts the global registry on
 * every boot via the unscoped `raw` client; then refreshes the type resolver
 * cache so writers resolve codes to ids without a database round-trip.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { DmsTypeResolver } from './dms-type-resolver.service';
import { seedDmsRegistry, wireDmsRoleKeys } from './dms.seed-registry';

@Injectable()
export class DmsSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DmsSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DmsTypeResolver,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await seedDmsRegistry(this.prisma.raw);
      const roles = await wireDmsRoleKeys(this.prisma.raw);
      await this.resolver.refresh();
      this.logger.log(
        `DMS registry ready: ${result.lifecycles} lifecycles, ${result.transitions} transitions, ` +
          `${result.types} types, ${result.relationTypes} relation types, ` +
          `${result.permissions} permission keys; ${roles} system role(s) provisioned`,
      );
    } catch (err) {
      this.logger.error(`DMS registry seeding failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}