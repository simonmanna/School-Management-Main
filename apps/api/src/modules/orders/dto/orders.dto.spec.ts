import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AddOrderItemsDto, CreateOrderDto, OrderLineInputDto,
  SaveOrderItemsDto, UpdateOrderSettingsDto,
} from './orders.dto';

/**
 * Back-office Orders DTO contract:
 *  - lines may be bare loose refs (menuItemId OR productId with no price) —
 *    the server resolves catalog metadata, so description/unitPrice are optional
 *  - a line MUST reference at least one of menuItemId / productId
 *  - settings accepts only the four line-source values
 *  - unknown properties are stripped (whitelist) — a client-sent `version`
 *    must never leak through to the service
 */
describe('Orders DTOs (unit)', () => {
  it('accepts a menu-only line with no client price (server resolves)', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      orderType: 'dine_in',
      lines: [{ menuItemId: 'm-1', quantity: 2 }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a product-only line with quantity (server resolves price)', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      orderType: 'takeaway',
      lines: [{ productId: 'p-1', quantity: 3 }],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a line with neither menuItemId nor productId', async () => {
    const dto = plainToInstance(CreateOrderDto, {
      orderType: 'delivery',
      lines: [{ description: 'freeform text only', quantity: 1 }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    // Nested line errors surface under the `lines` property's children.
    expect(JSON.stringify(errors)).toContain('customOrderLineRef');
  });

  it('rejects a zero/negative quantity', async () => {
    for (const qty of [0, -1]) {
      const dto = plainToInstance(OrderLineInputDto, { menuItemId: 'm-1', quantity: qty });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts client prices and tax overrides when provided', async () => {
    const dto = plainToInstance(OrderLineInputDto, {
      productId: 'p-1', quantity: 1, unitPrice: 25000, taxId: 't-1', discountPercent: 10,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown lineSource value in settings', async () => {
    const dto = plainToInstance(UpdateOrderSettingsDto, { lineSource: 'products2' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts all four line-source values', async () => {
    for (const lineSource of ['auto', 'menu', 'products', 'both']) {
      const dto = plainToInstance(UpdateOrderSettingsDto, { lineSource });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects unknown properties (forbidNonWhitelisted) — a client `version` must 400 like the app pipe', async () => {
    const dto = plainToInstance(SaveOrderItemsDto, {
      version: 42,
      expectedVersion: 1,
      lines: [{ menuItemId: 'm-1', quantity: 1 }],
    });
    // Mirrors main.ts ValidationPipe config (whitelist + forbidNonWhitelisted).
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('version');
    // Expected-field validation still passes when the unknown prop is stripped:
    // the pipe's whitelist strips `version` before the service ever sees it.
    const stripped = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    expect(stripped).toHaveLength(0);
  });

  it('rejects add-items payloads without lines', async () => {
    const dto = plainToInstance(AddOrderItemsDto, { lines: [] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});