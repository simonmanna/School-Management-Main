/** Generic back-office Orders — types mirroring the API surface. */

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export type OrderLineSource = 'auto' | 'menu' | 'products' | 'both';

export interface OrderSettings {
  lineSource: OrderLineSource;
  resolved: 'menu' | 'products' | 'both';
  posMode: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  orderType: OrderType;
  transactionKind: string;
  partnerId: string | null;
  partnerName: string | null;
  openedAt: string;
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  totalAmount: number;
  invoiceId: string | null;
  version: number;
  notes?: string | null;
  guestCount?: number | null;
  paymentTermId?: string | null;
  paymentMethod?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit' | null;
  createdAt: string;
}

export interface OrderLine {
  id: string;
  orderId: string;
  productId: string | null;
  menuItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxId: string | null;
  taxInclusive: boolean;
  note: string | null;
  lineNumber: number;
  cancelled: boolean;
  modifiers?: Array<{ id: string; name: string; priceDelta: number }>;
}

export interface OrderDetail extends Order {
  items: OrderLine[];
  partnerName: string | null;
  waiterName: string | null;
  tableName: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalAmount: string;
  } | null;
}

/** One order line input — EITHER a product (retail) OR a menu item ref. */
export interface OrderLineInput {
  productId?: string;
  menuItemId?: string;
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxId?: string;
  discountPercent?: number;
  discountType?: 'percentage' | 'fixed_amount';
  discountAmount?: number;
  discountReason?: string;
  note?: string;
  taxInclusive?: boolean;
}

export interface CreateOrderInput {
  orderType?: OrderType;
  partnerId?: string;
  transactionKind?: string;
  guestCount?: number;
  notes?: string;
  branchId?: string;
  paymentTermId?: string;
  paymentMethod?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  openedAt?: string;
  lines?: OrderLineInput[];
}

export interface UpdateOrderHeaderInput {
  orderType?: OrderType;
  partnerId?: string;
  guestCount?: number;
  notes?: string;
  paymentTermId?: string;
  paymentMethod?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  openedAt?: string;
}

export interface SaveOrderItemsInput {
  lines: OrderLineInput[];
  expectedVersion?: number;
}

export interface ListResponse<T> {
  rows: T[];
  total: number;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface BillOrderInput {
  paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  transactionDiscountPercent?: number;
  transactionDiscountType?: 'percentage' | 'fixed_amount';
  transactionDiscountAmount?: number;
  discountReason?: string;
  branchId?: string;
}