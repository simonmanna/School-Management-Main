/**
 * POS Tables Management (ADR-012) — shared client types.
 * Mirrors the API shapes in `apps/api/src/modules/pos/pos-tables*.ts`.
 */

export type PosTableStatus =
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'out_of_service'
  | 'cleaning';

export type PosTableShape = 'square' | 'rectangle' | 'circle';

/** Key of a configurable zone row (PosTableZone catalog) — dynamic, per-org. */
export type PosTableZone = string;

/** A configurable dining area / table category row (PosTableZone catalog). */
export interface PosTableZoneConfig {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  sortOrder: number;
  color: string;
  active: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type PosReservationStatus =
  | 'pending'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface PosTableOrder {
  id: string;
  tableId: string;
  orderId: string;
  customerName: string | null;
  guestCount: number | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  order?: {
    id: string;
    orderNumber: string;
    totalAmount: string;
    status: string;
    createdAt: string;
    billPrintCount: number;
    billLastPrintedAt: string | null;
  };
}

export interface PosTableReservationFE {
  id: string;
  tableId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  partySize: number;
  startAt: string;
  endAt: string;
  status: PosReservationStatus;
  notes: string | null;
  seatedAt: string | null;
  noShowAt: string | null;
  cancelledAt: string | null;
  seatedOrderId: string | null;
  table?: {
    id: string;
    number: number;
    name: string;
    status: PosTableStatus;
  };
}

export interface PosTable {
  id: string;
  organizationId: string;
  name: string;
  number: number;
  seats: number;
  zone: PosTableZone;
  /** Enriched by the API from the org's zone catalog (label + color). */
  zoneName?: string;
  zoneColor?: string | null;
  shape: PosTableShape;
  posX: number;
  posY: number;
  width: number;
  height: number;
  status: PosTableStatus;
  notes: string | null;
  sortOrder: number;
  active: boolean;
  assignedWaiterId: string | null;
  qrCodeUrl: string | null;
  mergedIntoId: string | null;
  mergedAt: string | null;
  mergedById: string | null;
  createdAt: string;
  updatedAt: string;
  orders?: PosTableOrder[];
  reservations?: PosTableReservationFE[];
  mergedInto?: { id: string; number: number; name: string } | null;
}

export interface PosTableStats {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  out_of_service: number;
  cleaning: number;
  occupancyPct: number;
}

export interface CreateTableInput {
  name: string;
  number: number;
  seats?: number;
  /** Key of a PosTableZone (dining area) — validated against the org catalog. */
  zone?: PosTableZone;
  shape?: PosTableShape;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  notes?: string;
  active?: boolean;
  assignedWaiterId?: string;
  sortOrder?: number;
  qrCodeUrl?: string;
}

export interface UpdateTableInput extends Partial<CreateTableInput> {}

export interface CreateReservationInput {
  tableId: string;
  customerName: string;
  phone?: string;
  email?: string;
  partySize?: number;
  startAt: string;
  endAt: string;
  notes?: string;
}

export interface UpdateReservationInput {
  customerName?: string;
  phone?: string;
  email?: string;
  partySize?: number;
  startAt?: string;
  endAt?: string;
  notes?: string;
}

export interface SplitBillInput {
  sourceOrderId: string;
  splits: Array<{
    label: string;
    lines: Array<{ sourceItemId: string; quantity: number }>;
  }>;
  partnerId?: string;
}

export interface UtilizationReport {
  date: string;
  totalActiveTables: number;
  hours: Array<{ hour: number; occupiedHours: number; occupancyPct: number }>;
  peakHours: number[];
}

export interface RevenueReport {
  fromDate: string;
  toDate: string;
  totals: {
    orders: number;
    revenue: string;
    averageDiningMinutes: number;
    turnoverRate: number;
  };
  perTable: Array<{
    tableId: string;
    number: number | null;
    name: string;
    zone: string;
    zoneName: string;
    zoneColor: string | null;
    orders: number;
    revenue: string;
  }>;
  perZone: Array<{
    zone: string;
    zoneName: string;
    zoneColor: string | null;
    orders: number;
    revenue: string;
  }>;
  topPerformers: Array<{
    tableId: string;
    number: number | null;
    name: string;
    zone: string;
    zoneName: string;
    zoneColor: string | null;
    orders: number;
    revenue: string;
  }>;
}

export interface ReservationReport {
  fromDate: string;
  toDate: string;
  totals: {
    pending: number;
    seated: number;
    completed: number;
    cancelled: number;
    noShow: number;
    total: number;
    noShowRate: number;
    completionRate: number;
  };
  byDay: Array<{
    day: string;
    pending: number;
    seated: number;
    completed: number;
    cancelled: number;
    noShow: number;
    total: number;
  }>;
}