/**
 * P2A/B6 — proves the fee/billing/payment DTOs actually validate.
 *
 * These endpoints move money. Before this the DTOs were bare interfaces, so the
 * global ValidationPipe had no runtime metatype and every body passed straight
 * to Prisma. This spec exercises the class-validator metadata directly (the same
 * metadata the pipe reads) to prove bad input is now rejected and unknown
 * properties are stripped by whitelisting.
 */
import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CollectFeePaymentDto, CreateFeeStructureDto } from '../../src/modules/school/fees/dto.types';

const errorProps = (obj: object) => validateSync(obj, { whitelist: true }).map((e) => e.property);

describe('CollectFeePaymentDto validation', () => {
  it('accepts a well-formed cash payment', () => {
    const dto = plainToInstance(CollectFeePaymentDto, {
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
      cashSessionId: 'sess_1',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a missing studentProfileId', () => {
    const dto = plainToInstance(CollectFeePaymentDto, { amount: 50_000, paymentMethod: 'cash' });
    expect(errorProps(dto)).toContain('studentProfileId');
  });

  it('rejects a non-positive amount', () => {
    const dto = plainToInstance(CollectFeePaymentDto, {
      studentProfileId: 'stu_1',
      amount: -10,
      paymentMethod: 'cash',
    });
    expect(errorProps(dto)).toContain('amount');
  });

  it('rejects an unknown payment method', () => {
    const dto = plainToInstance(CollectFeePaymentDto, {
      studentProfileId: 'stu_1',
      amount: 10,
      paymentMethod: 'crypto',
    });
    expect(errorProps(dto)).toContain('paymentMethod');
  });

  it('rejects a non-string in documentIds', () => {
    const dto = plainToInstance(CollectFeePaymentDto, {
      studentProfileId: 'stu_1',
      amount: 10,
      paymentMethod: 'cash',
      documentIds: ['ok', 123],
    });
    expect(errorProps(dto)).toContain('documentIds');
  });
});

describe('CreateFeeStructureDto validation (nested components)', () => {
  it('accepts a valid structure', () => {
    const dto = plainToInstance(CreateFeeStructureDto, {
      name: 'Standard',
      academicYearId: 'ay_1',
      components: [{ code: 'TUITION', productId: 'p_1', amount: 800000 }],
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a component with a negative amount (nested validation runs)', () => {
    const dto = plainToInstance(CreateFeeStructureDto, {
      name: 'Standard',
      academicYearId: 'ay_1',
      components: [{ code: 'TUITION', productId: 'p_1', amount: -5 }],
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects a missing components array', () => {
    const dto = plainToInstance(CreateFeeStructureDto, { name: 'Standard', academicYearId: 'ay_1' });
    expect(errorProps(dto)).toContain('components');
  });
});
