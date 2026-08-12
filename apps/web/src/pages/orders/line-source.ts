import type { OrderLineInput, OrderType, OrderLineSource } from '@/features/orders/types';

/** Resolved line-source metadata for the Orders pages. */
export interface LineSourceDef {
  kind: 'menu' | 'products' | 'both';
  label: string;
}

export const LINE_SOURCE_LABELS: Record<OrderLineSource, string> = {
  auto: 'Auto (follow POS mode)',
  menu: 'Menu items',
  products: 'Products',
  both: 'Both (menu + products)',
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

/** Server-resolved source ('menu' | 'products' | 'both'). */
export function sourceDef(resolved: 'menu' | 'products' | 'both'): LineSourceDef {
  switch (resolved) {
    case 'products':
      return { kind: 'products', label: 'Products' };
    case 'both':
      return { kind: 'both', label: 'Menu + Products' };
    default:
      return { kind: 'menu', label: 'Menu items' };
  }
}

/** Normalize a picked item into the shared OrderLineInput shape. */
export interface PickableItem {
  id: string;
  name: string;
  price: number;
  categoryName?: string | null;
  sku?: string | null;
}

export function toLineInput(item: PickableItem, kind: 'menu' | 'products'): OrderLineInput {
  if (kind === 'menu') {
    return {
      menuItemId: item.id,
      description: item.name,
      quantity: 1,
      unitPrice: item.price,
    };
  }
  return {
    productId: item.id,
    sku: item.sku ?? undefined,
    description: item.name,
    quantity: 1,
    unitPrice: item.price,
  };
}