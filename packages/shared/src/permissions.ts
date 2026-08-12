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
  uomCategory: {
    create: 'uom_category:create',
    read: 'uom_category:read',
    update: 'uom_category:update',
    delete: 'uom_category:delete',
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
  setting: {
    read: 'setting:read',
    update: 'setting:update',
  },
  auditLog: {
    read: 'audit_log:read',
  },
  costCenter: {
    create: 'cost_center:create',
    read: 'cost_center:read',
    update: 'cost_center:update',
    delete: 'cost_center:delete',
  },

  // ---- Accounting (Phase 2) ----
  account: {
    create: 'account:create',
    read: 'account:read',
    update: 'account:update',
    delete: 'account:delete',
  },
  /** Account categories define accounting *behavior* (normal balance, statement
   *  section, which module can auto-discover the account). They are global rows
   *  shared by every tenant and written only by the boot seeder, so there is no
   *  create / update / delete permission. */
  accountCategory: {
    create: 'account_category:create',
    read: 'account_category:read',
    update: 'account_category:update',
    delete: 'account_category:delete',
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
    approve: 'expense:approve',
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
  // ---- F.8 — Stock document wrappers + masters ----
  inventoryDoc: {
    create: 'inventory_doc:create',
    read: 'inventory_doc:read',
    update: 'inventory_doc:update',
    approve: 'inventory_doc:approve',
    delete: 'inventory_doc:delete',
  },
  // ---- Inventory count sessions (opening/closing physical counts) ----
  inventoryCount: {
    read: 'inventory_count:read',
    count: 'inventory_count:count',
    submit: 'inventory_count:submit',
  },
  // ---- Manufacturing — BOM / recipe master ----
  bom: {
    read: 'bom:read',
    create: 'bom:create',
    update: 'bom:update',
    activate: 'bom:activate',
    delete: 'bom:delete',
  },
  // ---- Manufacturing — production orders ----
  productionOrder: {
    read: 'production_order:read',
    create: 'production_order:create',
    start: 'production_order:start',
    complete: 'production_order:complete',
    cancel: 'production_order:cancel',
    approve: 'production_order:approve',
    qc: 'production_order:qc',
  },
  // ---- Manufacturing — demand requests (Phase 2) ----
  productionRequest: {
    read: 'production_request:read',
    create: 'production_request:create',
    submit: 'production_request:submit',
    approve: 'production_request:approve',
    reject: 'production_request:reject',
  },
  // ---- Manufacturing — planning (Phase 2) ----
  productionPlan: {
    read: 'production_plan:read',
    create: 'production_plan:create',
    update: 'production_plan:update',
    confirm: 'production_plan:confirm',
  },
  // ---- Manufacturing — reports/analytics ----
  production: {
    report: 'production:report',
  },
  // ---- Manufacturing Phase 4 — work centres, resources, routing, work orders ----
  workCenter: {
    read: 'work_center:read',
    create: 'work_center:create',
    update: 'work_center:update',
    delete: 'work_center:delete',
  },
  resource: {
    read: 'resource:read',
    create: 'resource:create',
    update: 'resource:update',
    delete: 'resource:delete',
  },
  routing: {
    read: 'routing:read',
    create: 'routing:create',
    delete: 'routing:delete',
  },
  workOrder: {
    read: 'work_order:read',
    manage: 'work_order:manage',
  },
  // ---- Configurable Inventory Posting Rules (M3) ----
  inventoryPostingRule: {
    read: 'inventory_posting_rule:read',
    update: 'inventory_posting_rule:update',
    create: 'inventory_posting_rule:create',
    delete: 'inventory_posting_rule:delete',
  },

  // ---- Beverage Control — digital-weight alcohol measurement (bar) ----
  beverage: {
    read: 'beverage:read',
    setup: 'beverage:setup',
    count: 'beverage:count',
    approve: 'beverage:approve',
  },

  // ---- Rental Management — hire-out of serialized/pooled assets ----
  rental: {
    read: 'rental:read',
    reserve: 'rental:reserve',
    manage: 'rental:manage',
    sign: 'rental:sign',
    checkout: 'rental:checkout',
    return: 'rental:return',
    settle: 'rental:settle',
    inspect: 'rental:inspect',
    waive: 'rental:waive',
    extend: 'rental:extend',
    swap: 'rental:swap',
    refundDeposit: 'rental:refund_deposit',
    service: 'rental:service',
    report: 'rental:report',
    overrideScore: 'rental:override_score',
  },

  // ---- Repair & Maintenance Management (RMMS) — item repair, maintenance,
  // field service, contract maintenance, preventive maintenance ----
  repair: {
    read: 'repair:read',
    create: 'repair:create',
    manage: 'repair:manage',
    diagnose: 'repair:diagnose',
    quote: 'repair:quote',
    approve: 'repair:approve',
    assign: 'repair:assign',
    work: 'repair:work',
    test: 'repair:test',
    deliver: 'repair:deliver',
    close: 'repair:close',
    parts: 'repair:parts',
    warranty: 'repair:warranty',
    contract: 'repair:contract',
    schedule: 'repair:schedule',
    report: 'repair:report',
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
    reconcile: 'cash_session:reconcile',
    // H3: taking cash OUT of the drawer (petty cash / bank drop) needs its own
    // grant — an opener should not be able to remove cash unsupervised.
    cashOut: 'cash_session:cash_out',
    // C3: approving a shift variance (segregation of duties — not the cashier).
    approveVariance: 'cash_session:approve_variance',
    // Medium: reopening a closed (not-yet-reconciled) session.
    reopen: 'cash_session:reopen',
  },
  // ---- Phase F: Branch permissions (also includes the F.5 vertical module perms)
  branch: {
    create: 'branch:create',
    read: 'branch:read',
    update: 'branch:update',
    delete: 'branch:delete',
    // Allows an admin to see / switch the user's home branch.
    assignUser: 'branch:assign_user',
  },
  // ---- POS Tables Management (ADR-012 / Phase T1) ----
  tables: {
    view: 'tables:view',
    create: 'tables:create',
    edit: 'tables:edit',
    delete: 'tables:delete',
    transfer: 'tables:transfer',
    merge: 'tables:merge',
    split: 'tables:split',
    clean: 'tables:clean',
    reserve: 'tables:reserve',
    // Manage the configurable zone (category) catalog — create/edit/archive/restore.
    zones: 'tables:zones',
  },
  // ---- Phase F.5: Vertical permissions (consumed by the verticals/* modules) ----
  pos: {
    read: 'pos:read',
    checkout: 'pos:checkout',
    refund: 'pos:refund',
    openSession: 'pos:open_session',
    closeSession: 'pos:close_session',
    hold: 'pos:hold',                 // park/recall a sale
    discount: 'pos:discount',         // apply > 0% discount without override
    void: 'pos:void',                 // void a line or a sale
    override: 'pos:override',         // approve a manager override (PIN)
    reports: 'pos:reports',           // X/Z + sales analytics
    deleteItem: 'pos:delete_item',    // remove an order item from the cart
    kds: 'pos:kds',                   // Kitchen Display: view board + advance tickets
  },
  school: {
    read: 'school:read',
    enroll: 'school:enroll',
    issueTermFees: 'school:issue_term_fees',
    recordPayment: 'school:record_payment',
    manageSchedule: 'school:manage_schedule',
  },
  notifications: {
    read: 'notifications:read',
    write: 'notifications:write',
  },
  procurement: {
    purchaseRequest: {
      create: 'purchase_request:create',
      read: 'purchase_request:read',
      update: 'purchase_request:update',
      delete: 'purchase_request:delete',
      approve: 'purchase_request:approve',
      submit: 'purchase_request:submit',
    },
    purchaseOrder: {
      create: 'purchase_order:create',
      read: 'purchase_order:read',
      update: 'purchase_order:update',
      delete: 'purchase_order:delete',
      approve: 'purchase_order:approve',
      send: 'purchase_order:send',
      cancel: 'purchase_order:cancel',
      receive: 'purchase_order:receive',
      pay: 'purchase_order:pay',
    },
    goodsReceipt: {
      create: 'goods_receipt:create',
      read: 'goods_receipt:read',
      post: 'goods_receipt:post',
      cancel: 'goods_receipt:cancel',
    },
    threeWayMatch: {
      read: 'three_way_match:read',
      approve: 'three_way_match:approve',
      override: 'three_way_match:override',
    },
  },
  debitNote: {
    create: 'debit_note:create',
    read: 'debit_note:read',
    post: 'debit_note:post',
    cancel: 'debit_note:cancel',
    approve: 'debit_note:approve',
  },
  files: {
    read: 'files:read',
    write: 'files:write',
    delete: 'files:delete',
  },
  webhooks: {
    read: 'webhooks:read',
    write: 'webhooks:write',
    delete: 'webhooks:delete',
  },
  approvals: {
    read: 'approvals:read',
    decide: 'approvals:decide',
    manage: 'approvals:manage',
  },
  // ---- Generic Orders (back-office Order CRUD, POS-independent) ----
    orders: {
      read: 'orders:read',
      create: 'orders:create',
      update: 'orders:update',
      cancel: 'orders:cancel',
      invoice: 'orders:invoice',
    },
    // ---- Frontend-facing management permissions (dot-notation) ----
    partners: {
    view: 'partners.view',
    create: 'partners.create',
    edit: 'partners.edit',
    delete: 'partners.delete',
  },
  products: {
    view: 'products.view',
    create: 'products.create',
    edit: 'products.edit',
    delete: 'products.delete',
  },
  menu: {
    view: 'menu.view',
    create: 'menu.create',
    edit: 'menu.edit',
    delete: 'menu.delete',
  },
  menuCategories: {
    view: 'menu_categories.view',
    create: 'menu_categories.create',
    edit: 'menu_categories.edit',
    delete: 'menu_categories.delete',
  },
  backup: {
    read: 'backup:read',
    update: 'backup:update',
    run: 'backup:run',
  },
  fixedAsset: {
    create: 'fixed_asset:create',
    read: 'fixed_asset:read',
    update: 'fixed_asset:update',
    delete: 'fixed_asset:delete',
    dispose: 'fixed_asset:dispose',
    transfer: 'fixed_asset:transfer',
    approveTransfer: 'fixed_asset:approve_transfer',
  },
  assetCategory: {
    create: 'asset_category:create',
    read: 'asset_category:read',
    update: 'asset_category:update',
    delete: 'asset_category:delete',
  },
  assetDepreciation: {
    read: 'asset_depreciation:read',
    run: 'asset_depreciation:run',
    approve: 'asset_depreciation:approve',
  },
  assetReport: {
    read: 'asset_report:read',
  },
  // NB: a top-level `organization` block already exists above (organization:*)
  // for the kernel-level organization entity; we do NOT redeclare it here.
  task: {
    create: 'task:create',
    read: 'task:read',
    update: 'task:update',
    delete: 'task:delete',
    assign: 'task:assign',
    verify: 'task:verify',
    reorder: 'task:reorder',
    manageLabels: 'task:manage_labels',
    manageTemplates: 'task:manage_templates',
    manageAutoRules: 'task:manage_auto_rules',
  },
  // ---- CRM (Phase A) — sales pipeline, activity timeline, analytics ----
  crm: {
    dashboardRead: 'crm:dashboard:read',
    dealRead: 'crm:deal:read',
    dealWrite: 'crm:deal:write',
    activityRead: 'crm:activity:read',
    activityWrite: 'crm:activity:write',
  },
  document: {
    create: 'document:create',
    read: 'document:read',
    update: 'document:update',
    delete: 'document:delete',
    print: 'document:print',
    archive: 'document:archive',
    manage: 'document:manage',
  },
  documentType: {
    create: 'doc:type:create',
    read: 'doc:type:read',
    update: 'doc:type:update',
    delete: 'doc:type:delete',
    manage: 'doc:type:manage',
  },
  // ---- Workforce Management (HR) — employees, attendance, timesheets,
  //      leave, payroll, payslips, advances, loans, tax tables, reviews ----
  hr: {
    read: 'hr:read',
    employee: 'hr:employee',
    attendance: 'hr:attendance',
    shift: 'hr:shift',
    timesheet: 'hr:timesheet',
    leave: 'hr:leave',
    holiday: 'hr:holiday',
    payroll: 'hr:payroll',
    payslip: 'hr:payslip',
    advance: 'hr:advance',
    loan: 'hr:loan',
    taxTable: 'hr:tax_table',
    performance: 'hr:performance',
    report: 'hr:report',
  },
  // ---- Communication platform — messaging + channels ----
  // NB: read/write/send are CAPABILITIES. Per-conversation ACCESS is enforced
  // separately by ConversationAccessService (participant / visibility / role).
  // readAll grants cross-conversation read (managers/support) but never opens a
  // `private` direct conversation.
  communication: {
    conversationRead: 'communication:conversation:read',
    conversationWrite: 'communication:conversation:write',
    conversationReadAll: 'communication:conversation:read_all',
    messageSend: 'communication:message:send',
    channelRead: 'communication:channel:read',
    channelManage: 'communication:channel:manage',
  },
} as const;

type PermissionLeaf<T> = T extends string ? T : T extends object ? PermissionLeaf<T[keyof T]> : never;
export type Permission = PermissionLeaf<typeof PERMISSIONS>;

/** Flattened list of every permission string (used for seeding the admin role). */
function flattenPermissions(input: unknown): string[] {
  if (typeof input === 'string') return [input];
  if (input && typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).flatMap(flattenPermissions);
  }
  return [];
}
export const ALL_PERMISSIONS: string[] = flattenPermissions(PERMISSIONS);