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
  income: {
    read: 'income:read',
    create: 'income:create',
    update: 'income:update',
    post: 'income:post',
    cancel: 'income:cancel',
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
    manageFoundation: 'school:foundation:write',
    /// Close, archive or re-open an academic year. Split from
    /// `manageFoundation` (re-audit P1-1): Front Desk and Registrar hold that
    /// grant to edit classes and terms, and archiving is irreversible.
    manageYearLifecycle: 'school:academicyear:lifecycle',
    manageStudents: 'school:students:write',
    /** Register a pupil who looks like an existing one, with a reason (ADR-032 P4, audit F07). */
    overrideDuplicate: 'school:students:override_duplicate',
    // Phase 1 (ADR-018 / ADR-019). Enrollment membership and placement history
    // are deliberately NOT folded into `school:students:write`: moving a
    // learner between classes rewrites who sits in which roster, which is an
    // academic-integrity action, while `students:write` is the front-desk
    // grant that edits a pupil's phone number.
    manageEnrollment: 'school:enrollment:write',
    /// Seat a learner beyond a class or stream's configured capacity (ADR-030).
    /// Split from `manageEnrollment` so exceeding a limit is a separately
    /// delegable decision; every use is recorded with a reason on the placement.
    overrideCapacity: 'school:enrollment:capacity:override',
    /// Bring a WITHDRAWN or TRANSFERRED learner back onto a roll (re-entry).
    /// Split from `manageEnrollment`: reversing an exit is a decision a school
    /// wants a senior person to own, and every use is recorded with a reason.
    reactivateEnrollment: 'school:enrollment:reactivate',
    /// Open medical documents and records. Separate from `school:read` so a
    /// teacher who can see the class list cannot open a pupil's health file.
    readMedical: 'school:medical:read',
    /// Programmes, annual class cohorts and grouping modes — configuration that
    /// changes how every downstream academic rule is resolved.
    manageProgrammes: 'school:programmes:write',
    /// Running and resolving the academic backfill / exception queue.
    runAcademicMigration: 'school:academics:migrate',
    manageStaff: 'school:staff:write',
    manageAdmissions: 'school:admissions:write',
    /// Accept / reject / waitlist an application. Separate from processing it,
    /// so the person who gathers the documents is not the person who decides.
    decideAdmissions: 'school:admissions:decide',
    // Admissions sub-grants (off by default; the broad write above is the legacy grant).
    scheduleAdmissionInterviews: 'school:admissions:interview',
    issueAdmissionOffers: 'school:admissions:offer',
    collectAdmissionFees: 'school:admissions:fee',
    // Registered but NOT yet enforced anywhere: the workflow endpoints gate on
    // manageAdmissions above. PermissionsGuard ANDs its requirements, so enforcing a
    // brand-new grant would 403 every existing administrator until roles are
    // backfilled. Wire it up in the same pass that activates the sub-grants above.
    manageAdmissionWorkflow: 'school:admissions:workflow',
    takeAttendance: 'school:attendance:write',
    // P-att-status: configure the org's attendance status catalog (CRUD).
    manageAttendanceStatuses: 'school:attendance:status:write',
    /**
     * Marks ENTRY only. Historically this single grant also covered approving
     * marks, exam setup and grading-scale edits — a segregation-of-duty failure,
     * since whoever entered a mark could approve their own mark. A0 narrows it
     * to entry and splits the rest out below.
     */
    enterGrades: 'school:grades:write',
    // ── Assessment (A0+). Action-level grants so marking, approving, moderating
    // and publishing are separately delegable. Reads stay on `school:read`
    // except analytics, which is genuinely more sensitive than a class list.
    manageExams: 'school:exams:write',
    // Assessment configuration: policies, weighting components, assessment instances.
    manageAssessments: 'school:assessments:write',
    approveGrades: 'school:grades:approve',
    moderateMarks: 'school:marks:moderate',
    computeResults: 'school:results:compute',
    approveResults: 'school:results:approve',
    publishResults: 'school:results:publish',
    amendResults: 'school:results:amend',
    // ── Examination operations (Phase 5). The exam office is a distinct role
    // from whoever teaches or approves marks: running a sitting, holding the
    // question papers and allocating scripts are separate acts, and the school
    // that cannot separate them still sees which grant was used.
    runExamOperations: 'school:exams:operate',
    manageExamCustody: 'school:exams:custody',
    allocateScripts: 'school:exams:allocate',
    markScripts: 'school:exams:mark',
    grantSpecialConsideration: 'school:exams:consideration',
    // Report provenance + promotion. Generating a document is not publishing it,
    // and recommending a promotion is not deciding one.
    manageReportDocuments: 'school:reports:documents:write',
    publishReportDocuments: 'school:reports:documents:publish',
    decidePromotion: 'school:promotion:decide',
    applyPromotion: 'school:promotion:apply',
    // ── Statutory workflows (Phase 6). A national submission leaves the school
    // and cannot be recalled, so producing the file is a different act from
    // designing the layout, and both are separate from reading the readiness
    // board. The Phase 6 migration backfills these onto the roles that already
    // hold `exams:operate` / `results:publish`, because PermissionsGuard ANDs
    // its requirements and an ungranted new grant 403s the exam office.
    // ── Early years (nursery). Separate grants because the acts are separate
    // people's: a class teacher writes the day's care notes, the front desk
    // releases a child at the gate, and a head teacher signs off an incident.
    // Reads stay on `school:read` except the incident log, which is a
    // safeguarding record and not a class list.
    /** Write and share the daily care log. Held by whoever is with the children. */
    manageCareLogs: 'school:carelog:write',
    /** Add, revoke and view pick-up authorizations. */
    managePickup: 'school:pickup:write',
    /** Record that a child was handed over — the gate action, not the list. */
    releaseChild: 'school:pickup:release',
    /** Read the incident log. A safeguarding record, not a class list. */
    readIncidents: 'school:incidents:read',
    /** Record an incident. Any adult who was there must be able to. */
    recordIncidents: 'school:incidents:write',
    /** Sign off a serious incident. Deliberately not the recorder's grant. */
    reviewIncidents: 'school:incidents:review',
    /** Immunisation rows and their due dates. */
    manageImmunisations: 'school:immunisation:write',
    /** Release a child to someone not on the pick-up list, with a reason (audit F06). */
    overridePickup: 'school:pickup:override',
    readStatutory: 'school:statutory:read',
    manageStatutoryTemplates: 'school:statutory:write',
    runStatutoryExports: 'school:statutory:export',
    /// Candidate/index-number registry — the mapping a national result is
    /// returned against. Wrong here means a learner's results are someone
    /// else's, so it is not folded into `students:write`.
    manageCandidateReferences: 'school:candidates:write',
    manageAssignments: 'school:assignments:write',
    gradeAssignments: 'school:assignments:grade',
    submitAssignments: 'school:assignments:submit',
    // LMS course delivery (Moodle-shaped, ADR-014). Coarse controller gate; the
    // fine-grained per-course authorization is the LMS capability system
    // (LmsRoleAssignment × LmsContext), checked inside handlers.
    manageCourses: 'school:courses:write',
    teachCourses: 'school:courses:teach',
    enrolLearners: 'school:courses:enrol',
    // LMS / Lesson Planning (Phase 1)
    manageLessonPlans: 'school:lessonplans:write',
    reviewLessonPlans: 'school:lessonplans:review',
    approveLessonPlans: 'school:lessonplans:approve',
    lmsRead: 'school:lms:read',
    // Teacher self-service scopes (owner-only writes). Used by @RequireOwnerOrPermission
    // so a teacher portal session can edit only its own rows without the broad write grant.
    ownLessonPlans: 'school:lessonplans:own',
    ownTimetable: 'school:timetable:own',
    /**
     * Take the register for a class you actually teach.
     *
     * `school:attendance:write` is org-wide — right for a deputy head, wrong for
     * a teacher marking from home, because it lets them mark any class in the
     * school. This grant carries no authority on its own: the handler resolves
     * the caller to their StaffProfile and checks TeacherAssignment/the timetable.
     */
    ownAttendance: 'school:attendance:own',
    /**
     * Enter marks for an assessment that is yours.
     *
     * Same split as attendance, for the same reason. `approveGrades` is
     * deliberately NOT paired with it: whoever enters a mark must not approve it.
     */
    ownGrades: 'school:grades:own',
    manageQuestionBank: 'school:questionbank:write',
    authorCbt: 'school:cbt:author',
    takeCbt: 'school:cbt:take',
    proctorCbt: 'school:cbt:proctor',
    issueCertificates: 'school:certificates:issue',
    revokeCertificates: 'school:certificates:revoke',
    readAnalytics: 'school:analytics:read',
    exportAnalytics: 'school:analytics:export',
    // Report centre (ADR-017). Deliberately NOT folded into `school:read` — that
    // grant is on ~300 routes and effectively everyone holds it, so gating the
    // report routes on it would make the route guard decorative and leave the
    // per-report check in the runner as the only real defence. Deliberately not
    // reusing `school:analytics:*` either: those are namespaced to the analytics
    // screens, and widening them would silently grant report access to whoever
    // already holds them.
    readReports: 'school:reports:read',
    exportReports: 'school:reports:export',
    // Fees, GL and audit reports are split out because "who owes money" is the
    // most sensitive set a school holds. Gating them on `school:fees:write`
    // instead would force a WRITE grant on a read-only bursar or governor.
    readFinanceReports: 'school:reports:finance:read',
    readAuditReports: 'school:reports:audit:read',
    manageSavedReports: 'school:reports:saved:write',
    scheduleReports: 'school:reports:schedule',
    manageFees: 'school:fees:write',
    // Read any pupil's fee balance, ledger, invoices, receipts and the finance
    // dashboards. Split from `school:read`, which every staff preset holds — a
    // class teacher or the librarian has no business reading family finances.
    readFees: 'school:fees:read',
    manageDocuments: 'school:documents:write',
    readDocuments: 'school:documents:read',
    collectPayments: 'school:fees:collect',
    refundFees: 'school:fees:refund',
    // Money-forgiving and money-creating actions. Separated from the blanket
    // `school:fees:write` in Phase 0 of the Fees & Finance hardening plan:
    // one permission previously let a single bursar edit fee structures,
    // create a waiver, apply it, and write off a debt with no second pair of
    // eyes anywhere — while the platform's own journal entries have enforced
    // maker-checker all along. A4 adds the approval workflow behind these;
    // holding one is already required to reach the endpoint.
    approveWaivers: 'school:fees:waiver:approve',
    approveCredits: 'school:fees:credit:approve',
    approveRefunds: 'school:fees:refund:approve',
    writeOffFees: 'school:fees:writeoff',
    approveAdjustments: 'school:fees:adjustment:approve',
    closePeriod: 'school:fees:period:close',
    reconcilePayments: 'school:fees:reconcile',
    manageLibrary: 'school:library:write',
    manageTransport: 'school:transport:write',
    transportRead: 'school:transport:read',
    manageFleet: 'school:transport:fleet',
    manageCrew: 'school:transport:crew',
    transportEnrollment: 'school:transport:enrollment',
    transportDispatch: 'school:transport:dispatch',
    transportBoarding: 'school:transport:boarding',
    transportOverride: 'school:transport:override',
    transportTracking: 'school:transport:tracking',
    transportIncidents: 'school:transport:incidents',
    transportBilling: 'school:transport:billing',
    transportReports: 'school:transport:reports',
    transportDriverApp: 'school:transport:driver',
    manageHostel: 'school:hostel:write',
    manageCafeteria: 'school:cafeteria:write',
    // Meals module (finer-grained; kitchen roles must not gain finance access).
    mealsRead: 'school:meals:read',
    manageMeals: 'school:meals:write', // programs/types/plans/menus config
    mealAttendance: 'school:meals:attendance',
    manageKitchen: 'school:meals:kitchen',
    mealBilling: 'school:meals:billing',
    manageWallet: 'school:meals:wallet',
    mealReports: 'school:meals:reports',
    communicate: 'school:communicate',
    parentPortal: 'school:portal:parent',
    studentPortal: 'school:portal:student',
    teacherPortal: 'school:portal:teacher',
    /**
     * "This account may ask the API who it is."
     *
     * The narrowest possible grant, and the reason portal roles do not carry
     * `school:read`. Around 300 routes across the school vertical are gated on
     * `school:read` alone — the full pupil register, every family's fee balance,
     * the gradebook and the marks workspace among them — so handing it to a
     * guardian to make two self-service routes work would have opened all of
     * them to anyone holding a valid portal token and a URL.
     *
     * Routes accepting this grant MUST derive their subject from the token
     * (`PortalIdentityService` / `EmployeeIdentityService`) and never from
     * request input. It carries no authority of its own.
     */
    portalSelf: 'school:portal:self',
    // Invite / revoke portal logins for students and guardians. Registrar-level:
    // it mints credentials that can see a family's grades and fee balance.
    managePortalAccounts: 'school:portal:accounts:write',
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
  featureFlag: {
    read: 'feature_flag:read',
    write: 'feature_flag:write',
  },
  recurring: {
    read: 'recurring:read',
    write: 'recurring:write',
  },
  search: {
    read: 'search:read',
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
    /**
     * Employee self-service: read YOUR OWN HR record only.
     * `hr:read` grants read of every employee's data, so it is the wrong gate
     * for a teacher checking their own payslip.
     */
    self: 'hr:self',
    employee: 'hr:employee',
    /**
     * Bind an HrEmployee to a login (`POST /hr/employees/:id/link-user`).
     * Split from `hr:employee` because `HrEmployee.userId` is what employee
     * self-service resolves on — whoever can set it can point a login at
     * someone else's payroll record.
     */
    employeeIdentity: 'hr:employee_identity',
    attendance: 'hr:attendance',
    shift: 'hr:shift',
    timesheet: 'hr:timesheet',
    leave: 'hr:leave',
    holiday: 'hr:holiday',
    payroll: 'hr:payroll',
    /**
     * Capture and edit one-off payroll inputs (bonuses, commissions, ad-hoc
     * deductions). Split from `hr:payroll` so a bursar's clerk can key a bonus
     * list without also being able to approve it into a payment — approving an
     * input, like approving a run, needs `hr:payroll`.
     */
    payrollInput: 'hr:payroll_input',
    /**
     * Run the HR report centre. Separate from `hr:read` for the same reason
     * `school:reports:read` is separate from `school:read`: `hr:read` sits on
     * most HR routes, so gating the report centre on it would be decorative,
     * and a payroll register is not the same disclosure as an employee list.
     */
    readReports: 'hr:reports:read',
    /** Download a report as CSV/XLSX/PDF — the point where data leaves the app. */
    exportReports: 'hr:reports:export',
    payslip: 'hr:payslip',
    advance: 'hr:advance',
    loan: 'hr:loan',
    taxTable: 'hr:tax_table',
    performance: 'hr:performance',
    report: 'hr:report',
    grade: 'hr:grade',
    contract: 'hr:contract',
    recruitment: 'hr:recruitment',
    qualification: 'hr:qualification',
    training: 'hr:training',
    offboarding: 'hr:offboarding',
    audit: 'hr:audit',
    /** Skills catalogue + per-employee skill links (Phase 1). */
    skill: 'hr:skill',
    /** Prior-employment history (Phase 1). */
    experience: 'hr:experience',
    /** Personnel documents — CV, ID scans, contract copies (Phase 1). */
    document: 'hr:document',
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
    // Broadcasts are split from ordinary message sending on purpose: composing a
    // one-to-one reply and pushing an SMS to 4,000 guardians are not the same
    // authority, and the second one costs the school money.
    broadcastRead: 'communication:broadcast:read',
    broadcastSend: 'communication:broadcast:send',
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

/* ────────────────────────────────────────────────────────────────────────────
 * Portal role presets
 *
 * Until these existed, `PortalAccountService.invite()` created a User with no
 * roles at all and no seed anywhere minted a role holding `school:portal:*`.
 * An invited guardian could accept their invite, log in successfully, and then
 * receive a 403 from every route — the portal had users but no authority.
 *
 * Defined here rather than in a seed file because three callers need the same
 * definition: `prisma/seed.ts` (fresh install), `OrganizationsService`
 * (each new tenant) and the one-shot backfill for orgs that already exist.
 *
 * `school:read` is deliberately included. Several self-scoped routes the portal
 * genuinely needs — `school/lms/my/*` above all — gate on it, and the per-subject
 * check that actually protects one family from another lives in
 * `PortalIdentityService`, not in the permission string. Widening this list is
 * therefore not the same risk as widening the routes; adding a grant here that
 * unlocks an org-wide WRITE would be.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RolePreset {
  name: string;
  description: string;
  permissions: string[];
  /** Data scope for staff persona presets (Phase 2). Portal presets omit it. */
  dataScope?: RoleDataScope;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Permission metadata — makes the admin UI matrix legible.
 *
 * The catalog (431 keys) uses `resource:action` (and a few dot-notation keys
 * from the POS frontend). `PERMISSION_META` supplies a human label + group +
 * optional `risk` flag for the keys that matter (every `school:*`, every
 * `hr:*`, and all approve/writeoff/delete/close/secrets keys); everything else
 * falls back to `humaniseKey()` which splits on the LAST `:`/`.` and
 * title-cases. Maintaining a hand-written entry per key would drift from the
 * catalog; instead we DERIVE from `PERMISSIONS` and override the high-value
 * ones. `risk: 'high'` marks segregation-of-duty keys an auditor must see.
 *
 * `buildPermissionCatalog()` returns the grouped `{ groups: [...] }` shape the
 * catalog endpoint serves — and is unit-tested so the grouping logic cannot
 * silently rot.
 * ──────────────────────────────────────────────────────────────────────────── */

export type RoleDataScope = 'own' | 'class' | 'department' | 'school';

/** Last-segment split that handles both `a:b:c` and `a.b.c` keys. */
function splitKey(key: string): { resource: string; action: string } {
  const sep = key.includes(':') ? ':' : '.';
  const idx = key.lastIndexOf(sep);
  return idx >= 0
    ? { resource: key.slice(0, idx), action: key.slice(idx + 1) }
    : { resource: key, action: key };
}

export function humaniseKey(key: string): string {
  const { action } = splitKey(key);
  return action
    .split(/[_\-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface PermissionMeta {
  label: string;
  description: string;
  group: string;
  subgroup?: string;
  risk?: 'high';
}

/**
 * Explicit metadata for the keys the admin UI must render correctly.
 * Keyed by the full permission string. Order is irrelevant — lookup is by key.
 */
export const PERMISSION_META: Record<string, PermissionMeta> = {
  // ── School: segregation-of-duty / money / secrets (all high-risk) ──────────
  'school:grades:approve': { label: 'Approve grades', description: 'Sign off marks entered by teachers. Must not be held by whoever enters them.', group: 'School', subgroup: 'Assessment', risk: 'high' },
  'school:results:approve': { label: 'Approve results', description: 'Approve a computed term/result set.', group: 'School', subgroup: 'Results', risk: 'high' },
  'school:results:publish': { label: 'Publish results', description: 'Release results to pupils and parents.', group: 'School', subgroup: 'Results', risk: 'high' },
  'school:results:amend': { label: 'Amend published results', description: 'Edit results after publication.', group: 'School', subgroup: 'Results', risk: 'high' },
  'school:marks:moderate': { label: 'Moderate marks', description: 'Review/adjust marks before approval.', group: 'School', subgroup: 'Assessment', risk: 'high' },
  'school:fees:waiver:approve': { label: 'Approve fee waiver', description: 'Approve a waiver of owed fees.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:credit:approve': { label: 'Approve fee credit', description: 'Approve a fee credit (overpayment/refundable).', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:refund:approve': { label: 'Approve fee refund', description: 'Approve a cash/material refund.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:adjustment:approve': { label: 'Approve fee adjustment', description: 'Approve a correction to a fee invoice.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:writeoff': { label: 'Write off fees', description: 'Forgive a fee debt entirely.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:period:close': { label: 'Close fee period', description: 'Lock a billing period to further changes.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:lessonplans:approve': { label: 'Approve lesson plans', description: 'Sign off lesson plans.', group: 'School', subgroup: 'Teaching', risk: 'high' },
  'role:create': { label: 'Create role', description: 'Define a new role.', group: 'Administration', subgroup: 'RBAC', risk: 'high' },
  'role:update': { label: 'Edit role', description: 'Change a role\'s permissions/scope.', group: 'Administration', subgroup: 'RBAC', risk: 'high' },
  'role:delete': { label: 'Delete role', description: 'Remove a role.', group: 'Administration', subgroup: 'RBAC', risk: 'high' },
  'user:create': { label: 'Create user', description: 'Provision a login.', group: 'Administration', subgroup: 'Users', risk: 'high' },
  'user:update': { label: 'Edit user', description: 'Change a user\'s roles/account.', group: 'Administration', subgroup: 'Users', risk: 'high' },
  'user:delete': { label: 'Delete user', description: 'Remove a login.', group: 'Administration', subgroup: 'Users', risk: 'high' },
  'backup:run': { label: 'Run backup', description: 'Trigger a data export/backup.', group: 'Administration', subgroup: 'System', risk: 'high' },
  'backup:update': { label: 'Manage backup config', description: 'Alter backup retention/location.', group: 'Administration', subgroup: 'System', risk: 'high' },
  'school:portal:accounts:write': { label: 'Manage portal accounts', description: 'Invite/revoke family & pupil logins — mints credentials that see grades and balances.', group: 'School', subgroup: 'Portal', risk: 'high' },
  'school:certificates:revoke': { label: 'Revoke certificates', description: 'Void an issued certificate.', group: 'School', subgroup: 'Certificates', risk: 'high' },

  // ── School: read / workspace (low-risk scaffolding the UI groups together) ──
  'school:read': { label: 'School read (org-wide)', description: 'Read any school record. Broad — grant deliberately.', group: 'School', subgroup: 'General' },
  'school:portal:self': { label: 'Ask who am I', description: 'The narrowest grant: the account may ask the API its own identity.', group: 'School', subgroup: 'Portal' },
  'school:students:write': { label: 'Manage students', description: 'CRUD pupil records.', group: 'School', subgroup: 'Students' },
  'school:enrollment:write': { label: 'Manage enrollment & placement', description: 'Enrol, move, transfer, withdraw, repeat and promote learners. Rewrites who sits in which class roster.', group: 'School', subgroup: 'Enrollment' },
  'school:programmes:write': { label: 'Manage programmes & cohorts', description: 'Academic programmes, annual class cohorts and section/stream grouping modes.', group: 'School', subgroup: 'Enrollment' },
  'school:academics:migrate': { label: 'Run academic backfill', description: 'Execute enrollment/placement backfills and resolve the migration exception queue.', group: 'School', subgroup: 'Enrollment' },
  'school:staff:write': { label: 'Manage staff', description: 'CRUD staff profiles.', group: 'School', subgroup: 'Staff' },
  'school:admissions:write': { label: 'Manage admissions', description: 'CRUD admission applications.', group: 'School', subgroup: 'Admissions' },
  'school:admissions:decide': { label: 'Decide admissions', description: 'Accept, reject or waitlist an application.', group: 'School', subgroup: 'Admissions', risk: 'high' },
  'school:students:override_duplicate': { label: 'Override duplicate pupil check', description: 'Register a pupil who matches an existing name and date of birth, with a written reason.', group: 'School', subgroup: 'Students', risk: 'high' },
  'school:pickup:override': { label: 'Override pick-up list', description: 'Release a child to an adult who is not on the pick-up list, with a written reason.', group: 'School', subgroup: 'Early years', risk: 'high' },
  'school:medical:read': { label: 'Read medical records', description: 'Open learners medical documents and health records.', group: 'School', subgroup: 'Students', risk: 'high' },
  'school:enrollment:reactivate': { label: 'Reactivate enrollment', description: 'Return a withdrawn or transferred learner to a class roll.', group: 'School', subgroup: 'Enrollment', risk: 'high' },
  'school:attendance:write': { label: 'Take attendance (org-wide)', description: 'Mark registers for any class. Use the own-scoped grant for teachers.', group: 'School', subgroup: 'Attendance' },
  'school:attendance:own': { label: 'Take own-class attendance', description: 'Mark registers for classes you teach only.', group: 'School', subgroup: 'Attendance' },
  'school:grades:write': { label: 'Enter grades', description: 'Enter marks. Approving is a separate grant.', group: 'School', subgroup: 'Assessment' },
  'school:grades:own': { label: 'Enter own marks', description: 'Enter marks for your own assessments only.', group: 'School', subgroup: 'Assessment' },
  'school:lessonplans:write': { label: 'Manage lesson plans', description: 'CRUD lesson plans (org-wide).', group: 'School', subgroup: 'Teaching' },
  'school:lessonplans:own': { label: 'Manage own lesson plans', description: 'CRUD your own lesson plans only.', group: 'School', subgroup: 'Teaching' },
  'school:timetable:own': { label: 'Manage own timetable', description: 'Edit your own timetable entries.', group: 'School', subgroup: 'Teaching' },
  'school:courses:write': { label: 'Manage course offerings', description: 'Create, staff, publish, close and roll over canonical teaching contexts.', group: 'School', subgroup: 'Teaching' },
  'school:courses:teach': { label: 'Teach assigned courses', description: 'Use teaching tools only inside an assigned offering.', group: 'School', subgroup: 'Teaching' },
  'school:courses:enrol': { label: 'Manage course rosters', description: 'Generate compulsory rosters and record elective, remedial, opt-out or withdrawal decisions.', group: 'School', subgroup: 'Enrollment' },
  'school:fees:read': { label: 'View fees & balances', description: 'Read fee balances, ledgers, invoices, receipts and finance dashboards for any pupil.', group: 'School', subgroup: 'Fees & Finance', risk: 'high' },
  'school:fees:write': { label: 'Manage fee structures', description: 'Configure fee categories/structures/schedules.', group: 'School', subgroup: 'Fees & Finance' },
  'school:fees:collect': { label: 'Collect payments', description: 'Record fee payments at the till/gate.', group: 'School', subgroup: 'Fees & Finance' },
  'school:fees:refund': { label: 'Issue refund', description: 'Pay money back to a payer.', group: 'School', subgroup: 'Fees & Finance' },
  'school:fees:reconcile': { label: 'Reconcile payments', description: 'Tie payments to the AR ledger.', group: 'School', subgroup: 'Fees & Finance' },
  'school:analytics:read': { label: 'Read analytics', description: 'View school analytics dashboards.', group: 'School', subgroup: 'Analytics' },
  'school:analytics:export': { label: 'Export analytics', description: 'Export analytics data.', group: 'School', subgroup: 'Analytics' },
  'school:reports:read': { label: 'Open the report centre', description: 'Run reports from the school report catalogue.', group: 'School', subgroup: 'Reports' },
  'school:reports:export': { label: 'Export reports', description: 'Download reports as CSV, Excel or PDF.', group: 'School', subgroup: 'Reports' },
  'school:reports:finance:read': { label: 'Run fee & finance reports', description: 'Fee balances, arrears, collections and GL reports.', group: 'School', subgroup: 'Reports', risk: 'high' },
  'school:reports:audit:read': { label: 'Run audit reports', description: 'Adjustments, waivers, reversals and permission changes.', group: 'School', subgroup: 'Reports', risk: 'high' },
  'school:reports:saved:write': { label: 'Manage saved reports', description: 'Save and edit report filter presets.', group: 'School', subgroup: 'Reports' },
  'school:reports:schedule': { label: 'Schedule reports', description: 'Run reports on a schedule and email the output.', group: 'School', subgroup: 'Reports', risk: 'high' },
  'school:documents:read': { label: 'Read school documents', description: 'View school document store.', group: 'School', subgroup: 'Documents' },
  'school:documents:write': { label: 'Manage school documents', description: 'Upload/edit the school document store.', group: 'School', subgroup: 'Documents' },
  'school:transport:write': { label: 'Manage transport', description: 'Configure routes, fleet and trips.', group: 'School', subgroup: 'Transport' },
  'school:transport:override': { label: 'Override transport rules', description: 'Bypass transport capacity/safety checks.', group: 'School', subgroup: 'Transport', risk: 'high' },
  'school:hostel:write': { label: 'Manage hostel', description: 'Configure hostel allocations.', group: 'School', subgroup: 'Hostel' },
  'school:meals:write': { label: 'Manage meals', description: 'Configure meal programs/menus.', group: 'School', subgroup: 'Meals' },
  'school:library:write': { label: 'Manage library', description: 'CRUD the library catalogue.', group: 'School', subgroup: 'Library' },
  'school:communicate': { label: 'Communicate', description: 'Send school communications.', group: 'School', subgroup: 'Communication' },
  'school:certificates:issue': { label: 'Issue certificates', description: 'Generate certificates.', group: 'School', subgroup: 'Certificates' },

  // ── HR (grouped, low/medium risk) ─────────────────────────────────────────
  'hr:self': { label: 'Own HR record', description: 'Read your own HR/payslip record.', group: 'HR', subgroup: 'Self-service' },
  'hr:read': { label: 'HR read (org-wide)', description: 'Read every employee\'s HR data.', group: 'HR', subgroup: 'General' },
  'hr:employee': { label: 'Manage employees', description: 'CRUD employee records.', group: 'HR', subgroup: 'Employees' },
  'hr:employee_identity': { label: 'Link employee to login', description: 'Bind an HrEmployee to a user account.', group: 'HR', subgroup: 'Employees', risk: 'high' },
  'hr:payroll': { label: 'Manage payroll', description: 'Run/configure payroll.', group: 'HR', subgroup: 'Payroll' },
  'hr:reports:read': { label: 'Run HR reports', description: 'Run the HR/payroll report centre.', group: 'HR', subgroup: 'Reporting' },
  'hr:reports:export': { label: 'Export HR reports', description: 'Download HR/payroll reports as CSV, Excel or PDF.', group: 'HR', subgroup: 'Reporting', risk: 'high' },
  'hr:payroll_input': { label: 'Capture payroll inputs', description: 'Key one-off bonuses, commissions and deductions (approval still needs hr:payroll).', group: 'HR', subgroup: 'Payroll' },
  'hr:payslip': { label: 'Manage payslips', description: 'Issue/adjust payslips.', group: 'HR', subgroup: 'Payroll' },
  'hr:audit': { label: 'HR audit', description: 'Read HR audit trails.', group: 'HR', subgroup: 'Compliance' },
};

/**
 * Build the grouped permission catalog for the admin UI.
 * Falls back to `humaniseKey` for any key without an explicit `PERMISSION_META`
 * entry, so the matrix still renders the 290+ plain-CRUD keys correctly.
 */
export function buildPermissionCatalog(): {
  groups: Array<{
    group: string;
    subgroups: Array<{
      subgroup: string;
      permissions: Array<{
        key: string;
        label: string;
        description: string;
        risk?: 'high';
      }>;
    }>;
  }>;
} {
  const groups = new Map<string, Map<string, Array<{ key: string; label: string; description: string; risk?: 'high' }>>>();

  for (const key of ALL_PERMISSIONS) {
    const meta = PERMISSION_META[key];
    const group = meta?.group ?? splitKey(key).resource;
    const subgroup = meta?.subgroup ?? humaniseKey(key);
    let subMap = groups.get(group);
    if (!subMap) {
      subMap = new Map();
      groups.set(group, subMap);
    }
    let list = subMap.get(subgroup);
    if (!list) {
      list = [];
      subMap.set(subgroup, list);
    }
    list.push({
      key,
      label: meta?.label ?? humaniseKey(key),
      description: meta?.description ?? `${humaniseKey(key)} (${key})`,
      ...(meta?.risk ? { risk: meta.risk } : {}),
    });
  }

  return {
    groups: [...groups.entries()].map(([group, subMap]) => ({
      group,
      subgroups: [...subMap.entries()].map(([subgroup, permissions]) => ({
        subgroup,
        permissions,
      })),
    })),
  };
}

export const PORTAL_ROLE_PRESETS: readonly RolePreset[] = [
  {
    name: 'Student',
    description: 'Portal access for a pupil — their own timetable, results, attendance and courses.',
    permissions: [
      PERMISSIONS.school.studentPortal,
      PERMISSIONS.school.portalSelf,
      PERMISSIONS.school.lmsRead,
      PERMISSIONS.school.submitAssignments,
      // Wave 2.3: sitting a CBT quiz. Held by no role, so no pupil could start
      // one. The route pins a student principal to their own attempt.
      PERMISSIONS.school.takeCbt,
    ],
  },
  {
    name: 'Parent',
    description: "Portal access for a guardian — their own children's fees, attendance and results.",
    permissions: [
      PERMISSIONS.school.parentPortal,
      // A guardian legitimately needs the PUPIL view of their own child —
      // timetable, results, attendance. These portal grants say which workspace
      // an account may open, not which pupil it may open it for; that second
      // question is answered by @ScopedToStudent against the token's portal
      // claim, so granting this does not widen who a parent can see.
      PERMISSIONS.school.studentPortal,
      PERMISSIONS.school.portalSelf,
      PERMISSIONS.school.lmsRead,
    ],
  },
  {
    name: 'Teacher',
    description: 'Teacher workspace — own classes, registers, marks and lesson plans, from anywhere.',
    permissions: [
      PERMISSIONS.school.teacherPortal,
      PERMISSIONS.school.portalSelf,
      // Unlike the family roles, a teacher DOES hold `school:read`. They need the
      // register, the class lists, the timetable and the subject tree, and those
      // reads are scattered across the vertical rather than mirrored behind
      // self-scoped routes. It is a real widening — `school:read` also reaches
      // fee balances and the gradebook — and it is the reason a Teacher role
      // should be granted deliberately by an administrator rather than minted by
      // an invite the way Student and Parent are.
      PERMISSIONS.school.read,
      PERMISSIONS.school.lmsRead,
      // Owner-scoped, not the org-wide `takeAttendance` / `enterGrades`. A teacher
      // working from home must be able to mark THEIR register and THEIR papers,
      // and nothing else; the org-wide grants would let them mark any class in
      // the school. The handlers resolve ownership — the grant alone decides
      // nothing.
      PERMISSIONS.school.ownAttendance,
      // Marks ENTRY only. `approveGrades` stays with admins — a teacher must not
      // be able to approve their own marks (the A0 segregation-of-duty split).
      PERMISSIONS.school.ownGrades,
      PERMISSIONS.school.ownLessonPlans,
      PERMISSIONS.school.ownTimetable,
      PERMISSIONS.hr.self,
    ],
  },
] as const;

/** The portal role a `PortalIdentity.subjectType` should be granted on invite. */
export const PORTAL_ROLE_BY_SUBJECT: Readonly<Record<'student' | 'guardian', string>> = {
  student: 'Student',
  guardian: 'Parent',
};

/* ────────────────────────────────────────────────────────────────────────────
 * School staff persona presets.
 *
 * Like PORTAL_ROLE_PRESETS, the canonical recommended configuration lives here so
 * seed.ts, OrganizationsService and the backfill share one definition. These are
 * PLAIN EDITABLE ROLES (isSystem: false): once provisioned into a tenant they
 * are the school's copy and must never be auto-overwritten by a later re-seed
 * (seed.ts uses `update: {}` + carries `dataScope`). Later improvements to a
 * preset are an explicit admin "update from preset" action, not a silent sync.
 *
 * `dataScope` is the "WHERE" dimension (see RoleDataScope / DataScopeService),
 * independent of the permission "WHAT". Default `school` for staff; `class` for a
 * Class Teacher so "teacher" means *their* class.
 *
 * SoD invariants enforced by role-presets.spec.ts:
 *   - Bursar holds no fees:*:approve / writeoff / period:close
 *   - Class Teacher holds no grades:approve / results:*
 *   - Exams Officer holds no fees:*
 *   - IT Admin holds no school:fees:* / school:grades:* / school:results:*
 * ──────────────────────────────────────────────────────────────────────────── */
export const SCHOOL_ROLE_PRESETS: readonly RolePreset[] = [
  // ── Tier 1 — lean core (ship first) ────────────────────────────────────────
  {
    name: 'Head Teacher',
    description: 'Approves relief (fee waivers/credits/refunds) but never collects; approves results.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:analytics:read',
      'school:analytics:export',
      'school:grades:approve',
      'school:results:approve',
      'school:results:publish',
      // Phase 5/6: the head teacher is the final academic authority, so the
      // document that goes home and the decision to move a learner up a class
      // are theirs, and so is signing off a national return.
      'school:reports:documents:publish',
      'school:promotion:decide',
      'school:promotion:apply',
      'school:admissions:decide',
      'school:enrollment:reactivate',
      // Re-audit P1-1: closing and archiving a year is the head's decision.
      'school:academicyear:lifecycle',
      'school:medical:read',
      // Early years: a serious incident is signed off by the head, deliberately
      // not by whoever recorded it.
      'school:incidents:read',
      'school:incidents:review',
      'school:pickup:override',
      'school:pickup:write',
      'school:statutory:read',
      'school:statutory:export',
      'school:lessonplans:review',
      'school:lessonplans:approve',
      'school:courses:write',
      'school:courses:enrol',
      'school:marks:moderate',
      'school:fees:waiver:approve',
      'school:fees:credit:approve',
      'school:fees:refund:approve',
      // Wave 2.3: these were held by NO preset, so only an Administrator could
      // approve an adjustment, write off a bad debt or close a fee period. They
      // are approvals, never collection, so they sit with the Head Teacher.
      'school:fees:adjustment:approve',
      'school:fees:writeoff',
      'school:fees:period:close',
      'school:certificates:revoke',
      'school:communicate',
      'school:staff:write',
      'school:documents:read',
      'school:documents:write',
      'school:certificates:issue',
      'hr:self',
      'approvals:decide',
      'approvals:manage',
      'audit_log:read',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
      'school:reports:finance:read',
      'school:fees:read',
      'school:reports:audit:read',
      'school:reports:saved:write',
    ],
  },
  {
    name: 'Bursar',
    description: 'Collects, reconciles and refunds fees; never approves its own relief.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:fees:write',
      'school:fees:collect',
      'school:fees:reconcile',
      'school:fees:refund',
      'school:analytics:read',
      // Re-audit #8: a sponsorship names its sponsor (a Partner). Without this
      // the Sponsors tab's picker answered 403 and stayed empty.
      'partner:read',
      'invoice:read',
      // `invoice:write` was listed here and is not a permission — the catalogue
      // has create/update/post — so a freshly provisioned Bursar could read an
      // invoice and never raise one. The grant did nothing and nothing said so.
      'invoice:create',
      'invoice:update',
      'invoice:post',
      'payment:read',
      'payment:create',
      'cash_session:read',
      'cash_session:open',
      'cash_session:close',
      'cash_session:reconcile',
      // Wave 2.3: meal billing and pupil meal wallets are fee-office money and
      // were held by no preset.
      'school:meals:billing',
      'school:meals:wallet',
      'hr:self',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
      'school:reports:finance:read',
      'school:fees:read',
      'school:reports:saved:write',
    ],
  },
  {
    name: 'Registrar',
    description: 'Admissions, enrolment and student records; no fee or grade authority.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:students:write',
      'school:students:override_duplicate',
      // Phase 1: the registrar is the role that moves, transfers, withdraws and
      // repeats learners, so the enrollment/placement grants live here.
      'school:enrollment:write',
      'school:programmes:write',
      'school:admissions:write',
      'school:admissions:interview',
      'school:admissions:offer',
      'school:admissions:fee',
      'school:admissions:workflow',
      'school:foundation:write',
      'school:portal:accounts:write',
      'school:documents:read',
      'school:documents:write',
      'school:certificates:issue',
      'school:communicate',
      'hr:self',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
      'school:reports:saved:write',
    ],
  },
  {
    name: 'Exams Officer',
    description: 'Runs the sitting, compiles results and files the national submission; approves neither marks nor results, and holds no fee authority.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:exams:write',
      'school:assessments:write',
      'school:grades:write',
      'school:results:compute',
      // `school:results:approve` is deliberately ABSENT. This preset also holds
      // `school:grades:write`, so granting the approval would let the same
      // person enter a mark and approve the result it feeds — the self-approval
      // the Phase 4/5 chain exists to prevent. Approval sits with the Head
      // Teacher and Deputy Head.
      'school:results:publish',
      'school:results:amend',
      'school:marks:moderate',
      // Phase 5 examination operations. Without these the exam office cannot
      // open the console that runs a sitting — holding the papers, allocating
      // scripts and granting an access arrangement are each their own act.
      'school:exams:operate',
      'school:exams:custody',
      'school:exams:allocate',
      'school:exams:consideration',
      'school:reports:documents:write',
      // Phase 6 national submissions. The office that runs the sitting is the
      // office that files the return, and designing the layout is separate from
      // producing the file.
      'school:statutory:read',
      'school:statutory:write',
      'school:statutory:export',
      'school:candidates:write',
      'school:questionbank:write',
      'school:cbt:author',
      'school:cbt:proctor',
      'school:certificates:issue',
      'school:analytics:read',
      'hr:self',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
    ],
  },
  {
    name: 'Class Teacher',
    description: 'Enters marks and takes registers for their own classes; never approves them.',
    dataScope: 'class',
    permissions: [
      'school:read',
      'school:attendance:own',
      'school:attendance:status:write',
      'school:grades:own',
      // Wave 2.3: marking an allocated exam script (held by no preset before).
      'school:exams:mark',
      'school:assignments:write',
      'school:assignments:grade',
      'school:lessonplans:own',
      'school:timetable:own',
      'school:courses:teach',
      'school:lms:read',
      'school:documents:read',
      'school:communicate',
      'school:portal:teacher',
      'school:portal:self',
      'hr:self',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
      // Early years: the adult in the room writes the day's care log and the
      // first record of an incident. Not the sign-off, and not the pick-up list.
      'school:carelog:write',
      'school:incidents:write',
      'school:incidents:read',
      // ADR-032 P2: health history of their own pupils (data scope limits it).
      'school:medical:read',
    ],
  },

  // ── Tier 2 — full set ───────────────────────────────────────────────────────
  {
    name: 'Deputy Head',
    description: 'Curriculum, timetable and teaching oversight across the school.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:foundation:write',
      'school:courses:write',
      'school:courses:enrol',
      'school:lessonplans:review',
      'school:lessonplans:approve',
      // Wave 2.3: school-wide lesson-plan management (teachers hold :own).
      'school:lessonplans:write',
      'school:assessments:write',
      // Approval authority the Exams Officer deliberately does not hold. A
      // school with no deputy still has the Head Teacher; a school with one
      // should not have to wait for the head to sign off every mark sheet.
      'school:grades:approve',
      'school:results:approve',
      'school:promotion:decide',
      'school:admissions:decide',
      'school:analytics:read',
      'school:analytics:export',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
      'school:reports:saved:write',
    ],
  },
  {
    name: 'Subject Teacher',
    description: 'Today\'s Teacher preset, rescoped from implicit to explicit `own`.',
    dataScope: 'own',
    permissions: [
      'school:portal:self',
      'school:portal:teacher',
      'school:read',
      'school:lms:read',
      'school:attendance:own',
      'school:grades:own',
      'school:lessonplans:own',
      'school:timetable:own',
      'hr:self',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
    ],
  },
  {
    name: 'HR Officer',
    description: 'Staff records and HR operations (no payroll approval, no HR audit).',
    dataScope: 'school',
    permissions: [
      'hr:read',
      'hr:employee',
      'hr:employee_identity',
      'hr:attendance',
      'hr:shift',
      'hr:timesheet',
      'hr:leave',
      'hr:holiday',
      'hr:payroll',
      'hr:payroll_input',
      'hr:reports:read',
      'hr:reports:export',
      'hr:payslip',
      'hr:advance',
      'hr:loan',
      'hr:tax_table',
      'hr:performance',
      'hr:grade',
      'hr:contract',
      'hr:recruitment',
      'hr:qualification',
      'hr:training',
      'hr:offboarding',
      'hr:skill',
      'hr:experience',
      'hr:document',
      'school:staff:write',
      'user:read',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:export',
    ],
  },
  {
    name: 'Librarian',
    description: 'Library catalogue and school documents.',
    dataScope: 'school',
    permissions: ['school:read', 'school:library:write', 'hr:self'],
  },
  {
    name: 'Nurse',
    description: 'Medical records, immunisation and emergency contacts for pupils.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:medical:read',
      'school:immunisation:write',
      'school:incidents:read',
      'school:incidents:write',
      'school:students:write',
      'school:documents:read',
      'school:documents:write',
      'hr:self',
    ],
  },
  {
    name: 'Transport Manager',
    description: 'Routes, fleet and trips (no override).',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:transport:write',
      'school:transport:read',
      'school:transport:fleet',
      'school:transport:crew',
      'school:transport:enrollment',
      'school:transport:dispatch',
      'school:transport:boarding',
      'school:transport:tracking',
      'school:transport:incidents',
      'school:transport:billing',
      'school:transport:reports',
      'hr:self',
    ],
  },
  {
    name: 'Hostel Warden',
    description: 'Hostel allocations and attendance.',
    dataScope: 'school',
    permissions: ['school:read', 'school:hostel:write', 'hr:self'],
  },
  {
    name: 'Catering',
    description: 'Meals programs, kitchen and reports.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:meals:read',
      'school:meals:write',
      'school:meals:attendance',
      'school:meals:kitchen',
      'school:meals:reports',
      'school:cafeteria:write',
      'hr:self',
    ],
  },
  {
    name: 'Front Desk',
    description: 'Visitors, applications intake, communication and the nursery gate.',
    dataScope: 'school',
    permissions: [
      'school:read',
      'school:foundation:write',
      'school:communicate',
      'partner:read',
      'hr:self',
      // The gate: who may collect a child, and the record that they did.
      'school:pickup:write',
      'school:pickup:release',
      'school:incidents:write',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
    ],
  },
  {
    name: 'IT Admin',
    description: 'System/role/user administration. No school finance or academic authority.',
    dataScope: 'school',
    permissions: [
      'user:create',
      'user:read',
      'user:update',
      'user:delete',
      'role:create',
      'role:read',
      'role:update',
      'role:delete',
      'setting:read',
      'setting:update',
      'backup:read',
      'backup:update',
      'backup:run',
      'feature_flag:read',
      'feature_flag:write',
      'webhooks:read',
      'webhooks:write',
      'organization:read',
      'audit_log:read',
      // Report centre (ADR-017). New grants do not reach existing tenants by
      // themselves — Role.permissions is stored data. See scripts/backfill-report-permissions.ts.
      'school:reports:read',
      'school:reports:audit:read',
    ],
  },
] as const;
