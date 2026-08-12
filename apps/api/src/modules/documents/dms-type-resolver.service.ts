/**
 * Fast code → DocumentTypeDef.id resolution for writers (Phase 1.3).
 * Cache is refreshed at boot by DmsSeeder and on cache miss falls back to a
 * single-key query, so first boots with partially-seeded registries still work.
 */
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';

type AnyClient = PrismaClient | Record<string, any>;

@Injectable()
export class DmsTypeResolver {
  private cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async refresh(): Promise<void> {
    const defs = await this.prisma.raw.documentTypeDef.findMany({
      select: { id: true, code: true },
    });
    this.cache = new Map(defs.map((d) => [d.code, d.id]));
  }

  /** Return the DocumentTypeDef id for a code; throw if unknown. */
  async resolveIdByCode(code: string, client?: AnyClient): Promise<string> {
    const cached = this.cache.get(code);
    if (cached) return cached;
    const db: AnyClient = client ?? this.prisma.raw;
    const def = await db.documentTypeDef.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!def) {
      throw new NotFoundException(`Unknown document type code: ${code}`);
    }
    this.cache.set(code, def.id);
    return def.id;
  }

  /** Snapshot of the cache (specs, diagnostics). */
  cachedIds(): ReadonlyMap<string, string> {
    return this.cache;
  }
}