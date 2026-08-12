/**
 * RBAC permission catalog. Format: `resource:action` (ADR Phase 0 auth).
 * Shared so the API guards and the Web permission-aware menus agree.
 */

export const PERMISSIONS = {
  organization: {
    create: 'organization:create',
    read: 'organization:read',
    update: 'organization:update',
    delete: 'organization:delete',
  },
  user: {
    create: 'user:create',
    read: 'user:read',
    update: 'user:update',
    delete: 'user:delete',
  },
  role: {
    create: 'role:create',
    read: 'role:read',
    update: 'role:update',
    delete: 'role:delete',
  },
  partner: {
    create: 'partner:create',
    read: 'partner:read',
    update: 'partner:update',
    delete: 'partner:delete',
  },
  partnerCategory: {
    create: 'partner_category:create',
    read: 'partner_category:read',
    update: 'partner_category:update',
    delete: 'partner_category:delete',
  },
  product: {
    create: 'product:create',
    read: 'product:read',
    update: 'product:update',
    delete: 'product:delete',
  },
  productCategory: {
    create: 'product_category:create',
    read: 'product_category:read',
    update: 'product_category:update',
    delete: 'product_category:delete',
  },
  uom: {
    create: 'uom:create',
    read: 'uom:read',
    update: 'uom:update',
    delete: 'uom:delete',
  },
  tax: {
    create: 'tax:create',
    read: 'tax:read',
    update: 'tax:update',
    delete: 'tax:delete',
  },
  currency: {
    create: 'currency:create',
    read: 'currency:read',
    update: 'currency:update',
    delete: 'currency:delete',
  },
  fiscalPeriod: {
    create: 'fiscal_period:create',
    read: 'fiscal_period:read',
    update: 'fiscal_period:update',
    delete: 'fiscal_period:delete',
  },
  branch: {
    create: 'branch:create',
    read: 'branch:read',
    update: 'branch:update',
    delete: 'branch:delete',
    // Allows an admin to see / switch the user's home branch.
    assignUser: 'branch:assign_user',
  },
  setting: {
    read: 'setting:read',
    update: 'setting:update',
  },
  auditLog: {
    read: 'audit_log:read',
  },

  // ---- Accounting (Phase 2) ----
  account: {
    create: 'account:create',
    read: 'account:read',
    update: 'account:update',
    delete: 'account:delete',
  },
  journal: {
    create: 'journal:create',
    read: 'journal:read',
    update: 'journal:update',
    delete: 'journal:delete',
  },
  journalEntry: {
    read: 'journal_entry:read',
    create: 'journal_entry:create',
    post: 'journal_entry:post',
    reverse: 'journal_entry:reverse',
  },
  accountMapping: {
    read: 'account_mapping:read',
    update: 'account_mapping:update',
  },
  bankAccount: {
    create: 'bank_account:create',
    read: 'bank_account:read',
    update: 'bank_account:update',
    delete: 'bank_account:delete',
  },
  treasury: {
    read: 'treasury:read',
    transfer: 'treasury:transfer',
  },

  // ---- Invoicing / AR (Phase 3) ----
  invoice: {
    read: 'invoice:read',
    create: 'invoice:create',
    update: 'invoice:update',
    post: 'invoice:post',
    cancel: 'invoice:cancel',
    delete: 'invoice:delete',
  },
  creditNote: {
    read: 'credit_note:read',
    create: 'credit_note:create',
    post: 'credit_note:post',
  },
  expense: {
    read: 'expense:read',
    create: 'expense:create',
    update: 'expense:update',
    post: 'expense:post',
    cancel: 'expense:cancel',
  },
  payment: {
    read: 'payment:read',
    create: 'payment:create',
    allocate: 'payment:allocate',
    void: 'payment:void',
  },
  report: {
    accounting: 'report:accounting',
    ar: 'report:ar',
  },

  // ---- Inventory (Phase 4) ----
  inventoryLocation: {
    create: 'inventory_location:create',
    read: 'inventory_location:read',
    update: 'inventory_location:update',
    delete: 'inventory_location:delete',
  },
  inventory: {
    read: 'inventory:read',
    move: 'inventory:move',
  },

  // ---- M5: Cash registers / sessions (foundation) ----
  cashRegister: {
    create: 'cash_register:create',
    read: 'cash_register:read',
    update: 'cash_register:update',
    delete: 'cash_register:delete',
  },
  cashSession: {
    open: 'cash_session:open',
    read: 'cash_session:read',
    close: 'cash_session:close',
  },

  // ---- School Vertical ----
  school: {
    read: 'school:read',
    manageFoundation: 'school:foundation:write',
    manageStudents: 'school:students:write',
    manageStaff: 'school:staff:write',
    manageAdmissions: 'school:admissions:write',
    takeAttendance: 'school:attendance:write',
    enterGrades: 'school:grades:write',
    manageFees: 'school:fees:write',
    collectPayments: 'school:fees:collect',
    manageLibrary: 'school:library:write',
    manageTransport: 'school:transport:write',
    manageHostel: 'school:hostel:write',
    manageCafeteria: 'school:cafeteria:write',
    communicate: 'school:communicate',
    parentPortal: 'school:portal:parent',
    studentPortal: 'school:portal:student',
    teacherPortal: 'school:portal:teacher',
  },
} as const;

type PermissionLeaf<T> = T extends string ? T : T extends object ? PermissionLeaf<T[keyof T]> : never;
export type Permission = PermissionLeaf<typeof PERMISSIONS>;

/** Flattened list of every permission string (used for seeding the admin role). */
export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group as Record<string, string>),
);