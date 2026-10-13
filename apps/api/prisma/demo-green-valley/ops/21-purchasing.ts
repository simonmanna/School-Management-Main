/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 21 — purchasing.
 *
 * How goods reach the store: a head of department raises a requisition, the
 * head teacher approves it, the bursar turns it into a purchase order on a
 * known supplier, the storekeeper receives the delivery against the order
 * (which capitalises the stock and accrues the payable), and the bursar pays
 * the supplier from the Centenary operations account.
 *
 * The year leaves the usual tail: two deliveries only part-complete, three
 * invoices still unpaid, an order cancelled when the supplier's price jumped,
 * a requisition rejected, and debit notes for a short delivery and for goods
 * returned because they were the wrong size.
 *
 * Service suppliers (not goods) are billed instead: a vendor bill is raised,
 * approved and settled through supplier payments, so the AP ledger and the
 * supplier statements both have something to show.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso } from './kit';
import type { Books } from './13-accounts';
import type { Store } from './20-store';
import type { Roster } from './roster';

/** Suppliers of goods for the store (the service suppliers live in stage 16). */
const SUPPLIERS: Record<string, { name: string; phone: string; address: string; tin?: string }> = {
  SCHOLASTIC: { name: 'Picfare Industries Ltd', phone: '+256414251234', address: 'Nalukolongo Industrial Area, Kampala', tin: '1000024578' },
  STATIONERY: { name: 'Kampala Stationery Centre', phone: '+256414235566', address: 'Plot 14 Nasser Road, Kampala', tin: '1000112947' },
  UNIFORM: { name: 'Nakasero School Uniform Tailors', phone: '+256772884511', address: 'Nakasero Market Lane, Kampala', tin: '1000447812' },
  ICT: { name: 'Ntinda Computer Point', phone: '+256752117430', address: 'Ntinda Shopping Complex, Kampala', tin: '1000663295' },
  BOOKSHOP: { name: 'Aristoc Booklex Ltd', phone: '+256414254257', address: 'Garden City Mall, Kampala', tin: '1000210884' },
  CLEAN: { name: 'CleanPro Hygiene Supplies Ltd', phone: '+256393217744', address: 'Bweyogerere Industrial Park', tin: '1000338571' },
  PHARMACY: { name: 'Nsambya Pharmacy & Medical Supplies', phone: '+256772334015', address: 'Nsambya Road, Kampala', tin: '1000551209' },
  SPORTS: { name: 'Sports Arena Uganda Ltd', phone: '+256414258833', address: 'Lugogo Bypass, Kampala', tin: '1000774163' },
  MATTRESS: { name: 'Mukono Mattress Makers', phone: '+256701998512', address: 'Mukono Town, Nabuti Road', tin: '1000889405' },
  HARDWARE: { name: 'Ntinda Hardware & Builders', phone: '+256704903365', address: 'Ntinda–Kisaasi Road, Kampala', tin: '1000996318' },
};

type POSpec = {
  key: string;
  day: string;
  supplier: keyof typeof SUPPLIERS;
  title: string;
  warehouse: string;
  requisition?: { by: 'dos' | 'bursar' | 'registrar' | 'kitchen'; note: string };
  lines: Array<[string, number]>;
  /** days after the order the goods arrive; null = still awaiting delivery */
  deliverLag: number | null;
  /** 1 = full delivery, <1 = part delivered */
  deliverPart?: number;
  /** days after delivery the supplier is paid; null = still unpaid */
  payLag: number | null;
  cancelled?: string;
  terms?: string;
};

/** Service bills: no goods, so no PO — a vendor bill the bursar settles. */
const SERVICE_BILLS: Array<{
  key: string;
  day: string;
  supplier: { code: string; name: string; phone: string };
  description: string;
  account: string;
  amount: number;
  payLag: number | null;
  dueDays: number;
}> = [
  { key: 'audit-2025', day: '2026-02-17', supplier: { code: 'SUP-AUDIT', name: 'Mwesigwa & Associates, Certified Public Accountants', phone: '+256414505112' }, description: 'Audit of the 2025 financial statements', account: '5890', amount: 4_500_000, payLag: 21, dueDays: 30 },
  { key: 'borehole-service', day: '2026-03-10', supplier: { code: 'SUP-WATERWORKS', name: 'Aqua Drill Uganda Ltd', phone: '+256772660145' }, description: 'Servicing of the school borehole pump and pressure tank', account: '5850', amount: 2_850_000, payLag: 14, dueDays: 21 },
  { key: 'ict-support-h1', day: '2026-04-14', supplier: { code: 'SUP-ICTSERV', name: 'Sahara ICT Services Ltd', phone: '+256393266010' }, description: 'Computer laboratory support contract – January to June 2026', account: '5890', amount: 3_200_000, payLag: 18, dueDays: 30 },
  { key: 'landscaping-t2', day: '2026-06-11', supplier: { code: 'SUP-GARDEN', name: 'Green Lawns Landscaping Services', phone: '+256701339842' }, description: 'Compound slashing, hedge trimming and flower beds – Term 2', account: '5850', amount: 1_450_000, payLag: 9, dueDays: 14 },
  { key: 'security-guards-q3', day: '2026-07-15', supplier: { code: 'SUP-GUARDS', name: 'Saracen Uganda Ltd – Guard Services', phone: '+256312262000' }, description: 'Night guard services – July to September 2026 (3 guards)', account: '5885', amount: 5_400_000, payLag: 25, dueDays: 30 },
  { key: 'ict-support-h2', day: '2026-09-15', supplier: { code: 'SUP-ICTSERV', name: 'Sahara ICT Services Ltd', phone: '+256393266010' }, description: 'Computer laboratory support contract – July to December 2026', account: '5890', amount: 3_200_000, payLag: null, dueDays: 30 },
  { key: 'graduation-tents', day: '2026-09-28', supplier: { code: 'SUP-EVENTS', name: 'Royal Events & Tent Hire', phone: '+256782551007' }, description: 'Tents, chairs and PA system – nursery graduation rehearsal', account: '5896', amount: 1_980_000, payLag: null, dueDays: 21 },
];

export async function seedPurchasing(ctx: Ctx, tl: Timeline, books: Books, store: Store, roster: Roster): Promise<void> {
  const { prisma, O } = ctx;
  const requests = ctx.svc('modules/procurement/purchase-requests.service', 'PurchaseRequestsService');
  const orders = ctx.svc('modules/procurement/purchase-orders.service', 'PurchaseOrdersService');
  const debitNotes = ctx.svc('modules/procurement/debit-notes.service', 'DebitNotesService');
  const bills = ctx.svc('modules/invoicing/vendor-bill/vendor-bill.service', 'VendorBillService');
  const payments = ctx.svc('modules/invoicing/payment/payment.service', 'PaymentService');

  // ── 1. Suppliers ─────────────────────────────────────────────────────────
  const supplierId = new Map<string, string>();
  for (const [key, s] of Object.entries(SUPPLIERS)) {
    const row = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: `SUP-${key}` } },
      update: { name: s.name, isSupplier: true, taxNumber: s.tin, phone: s.phone },
      create: { organizationId: O, code: `SUP-${key}`, name: s.name, phone: s.phone, taxNumber: s.tin, isSupplier: true, isCompany: true },
    });
    supplierId.set(key, row.id);
  }
  for (const b of SERVICE_BILLS) {
    const row = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: b.supplier.code } },
      update: { name: b.supplier.name, isSupplier: true },
      create: { organizationId: O, code: b.supplier.code, name: b.supplier.name, phone: b.supplier.phone, isSupplier: true, isCompany: true },
    });
    supplierId.set(b.supplier.code, row.id);
  }

  // ── 2. The year's purchase orders ────────────────────────────────────────
  const specs: POSpec[] = [];
  const termStart = (no: 1 | 2 | 3) => roster.term(no).start;

  for (const no of [1, 2, 3] as const) {
    const start = termStart(no);
    const r = rng(`po:term:${no}`);
    specs.push({
      key: `scholastic-t${no}`,
      day: weekday(addDaysIso(start, -18)),
      supplier: 'SCHOLASTIC',
      title: `Term ${no} exercise books and pencils`,
      warehouse: 'STORE-MAIN',
      requisition: { by: 'dos', note: `Term ${no} scholastic materials for all classes (nursery to P.7)` },
      lines: [
        ['STK-EXB-32', 800],
        ['STK-EXB-48', 600],
        ['STK-EXB-96', 300],
        ['STK-PENCIL', 500],
        ['STK-ERASER', 200],
      ],
      deliverLag: int(r, 4, 8),
      payLag: no === 3 ? null : int(r, 12, 25),
      terms: '30 days from delivery',
    });
    specs.push({
      key: `stationery-t${no}`,
      day: weekday(addDaysIso(start, -12)),
      supplier: 'STATIONERY',
      title: `Term ${no} chalk, markers, manila and photocopy paper`,
      warehouse: 'STORE-MAIN',
      requisition: { by: 'dos', note: `Teaching materials and office paper for Term ${no}` },
      lines: [
        ['STK-CHALK', 80],
        ['STK-MARKER', 60],
        ['STK-MANILA', 200],
        ['STK-PAPER-A4', 60],
        ['STK-PEN-BLUE', 300],
        ['STK-PEN-RED', 100],
      ],
      deliverLag: int(r, 3, 7),
      payLag: int(r, 7, 20),
      terms: '14 days',
    });
    specs.push({
      key: `uniform-t${no}`,
      day: weekday(addDaysIso(start, -22)),
      supplier: 'UNIFORM',
      title: `Term ${no} uniform stock for the school shop`,
      warehouse: 'STORE-SCHOL',
      requisition: { by: 'bursar', note: `Uniform stock for new pupils and replacements – Term ${no}` },
      lines: [
        ['STK-UNI-NUR', 60],
        ['STK-UNI-PRI', 90],
        ['STK-SWEATER', 80],
        ['STK-SOCKS', 150],
        ['STK-BADGE', 200],
      ],
      deliverLag: int(r, 8, 14),
      deliverPart: no === 3 ? 0.6 : 1,
      payLag: no === 3 ? null : int(r, 10, 22),
      terms: 'Half on order, half on delivery',
    });
    specs.push({
      key: `cleaning-t${no}`,
      day: weekday(addDaysIso(start, 3)),
      supplier: 'CLEAN',
      title: `Term ${no} cleaning and sanitation supplies`,
      warehouse: 'STORE-CLEAN',
      lines: [
        ['STK-JIK', 120],
        ['STK-SOAP-BAR', 150],
        ['STK-OMO', 60],
        ['STK-TISSUE', 600],
        ['STK-HANDSOAP', 80],
        ['STK-GLOVES', 20],
      ],
      deliverLag: int(r, 2, 5),
      payLag: int(r, 5, 14),
      terms: '14 days',
    });
    specs.push({
      key: `sickbay-t${no}`,
      day: weekday(addDaysIso(start, 6)),
      supplier: 'PHARMACY',
      title: `Term ${no} sick bay drugs and first aid`,
      warehouse: 'STORE-SICK',
      requisition: { by: 'registrar', note: `Sick bay restocking for Term ${no} (matron's list)` },
      lines: [
        ['STK-ORS', 200],
        ['STK-COARTEM', 80],
        ['STK-PARA', 6],
        ['STK-PLASTER', 10],
        ['STK-SPIRIT', 12],
        ['STK-COTTON', 10],
      ],
      deliverLag: int(r, 2, 6),
      payLag: int(r, 4, 12),
      terms: 'Cash on delivery',
    });
  }

  // One-off orders through the year.
  specs.push(
    {
      key: 'library-books-jan',
      day: '2026-01-15',
      supplier: 'BOOKSHOP',
      title: 'Library stock-up: PLE revision kits and class readers',
      warehouse: 'STORE-MAIN',
      requisition: { by: 'dos', note: 'Library acquisitions approved by the academic board for 2026' },
      lines: [['STK-COUNTER', 40], ['STK-FILE', 20]],
      deliverLag: 9,
      payLag: 18,
      terms: '30 days',
    },
    {
      key: 'toner-feb',
      day: '2026-02-10',
      supplier: 'ICT',
      title: 'Toner cartridges and office consumables (first half)',
      warehouse: 'STORE-MAIN',
      lines: [['STK-TONER', 4], ['STK-STAPLES', 20], ['STK-PAPER-A3', 10]],
      deliverLag: 4,
      payLag: 10,
      terms: '14 days',
    },
    {
      key: 'sports-mar',
      day: '2026-03-03',
      supplier: 'SPORTS',
      title: 'Inter-house sports equipment and jerseys',
      warehouse: 'STORE-SPORT',
      requisition: { by: 'dos', note: 'Equipment for inter-house sports and the Wakiso zone games' },
      lines: [['STK-BALL-FOOT', 8], ['STK-BALL-NET', 6], ['STK-JERSEY', 40]],
      deliverLag: 6,
      payLag: 15,
      terms: '21 days',
    },
    {
      key: 'boarding-may',
      day: '2026-05-19',
      supplier: 'MATTRESS',
      title: 'Boarding section mattresses and beddings',
      warehouse: 'STORE-SPORT',
      requisition: { by: 'registrar', note: 'Replacement beddings for the girls’ dormitory' },
      lines: [['STK-MATTRESS', 12], ['STK-BLANKET', 20], ['STK-BEDSHEET', 30]],
      deliverLag: 7,
      deliverPart: 0.75,
      payLag: 20,
      terms: '30 days',
    },
    {
      key: 'toner-aug',
      day: '2026-08-11',
      supplier: 'ICT',
      title: 'Toner cartridges and office consumables (second half)',
      warehouse: 'STORE-MAIN',
      lines: [['STK-TONER', 4], ['STK-STAPLES', 20], ['STK-STAMPPAD', 6]],
      deliverLag: 5,
      payLag: null,
      terms: '14 days',
    },
    {
      key: 'bags-sep',
      day: '2026-09-08',
      supplier: 'UNIFORM',
      title: 'Branded school bags for the 2027 admissions campaign',
      warehouse: 'STORE-SCHOL',
      lines: [['STK-BAG', 60]],
      deliverLag: 12,
      payLag: null,
      terms: '30 days',
    },
    {
      key: 'hardware-sep',
      day: '2026-09-22',
      supplier: 'HARDWARE',
      title: 'Waste bins, mops and brooms for the new term',
      warehouse: 'STORE-MAIN',
      lines: [['STK-BIN', 15], ['STK-MOP', 12], ['STK-BROOM', 30]],
      deliverLag: null,
      payLag: null,
      terms: '14 days',
    },
    {
      key: 'maths-sets-oct',
      day: '2026-10-01',
      supplier: 'STATIONERY',
      title: 'Mathematical sets and rulers for P.6 and P.7',
      warehouse: 'STORE-SCHOL',
      requisition: { by: 'dos', note: 'Geometry sets for the P.7 candidates’ revision' },
      lines: [['STK-MATHSET', 80], ['STK-RULER', 120]],
      deliverLag: null,
      payLag: null,
      terms: '14 days',
    },
    {
      key: 'crayons-cancelled',
      day: '2026-04-21',
      supplier: 'SCHOLASTIC',
      title: 'Crayons and colouring materials for the nursery',
      warehouse: 'STORE-SCHOL',
      lines: [['STK-CRAYON', 150]],
      deliverLag: null,
      payLag: null,
      cancelled: 'Supplier raised the unit price by 22% after the order was placed; re-ordered from Kampala Stationery Centre.',
      terms: '14 days',
    },
  );

  // ── 3. Requisition → order → delivery → payment, on the timeline ─────────
  const poKey = (key: string) => `demo:po:${key}`;
  const findPO = (key: string) => prisma.purchaseOrder.findFirst({ where: { organizationId: O, notes: { contains: poKey(key) } }, include: { lines: true } });

  let requisitions = 0;
  for (const s of specs) {
    if (s.day > ctx.asOf) continue;
    const total = s.lines.reduce((sum, [code, qty]) => sum + qty * store.item(code).cost, 0);

    if (s.requisition) {
      requisitions += 1;
      tl.add({
        at: eat(weekday(addDaysIso(s.day, -4)), '09:30'),
        priority: 20,
        label: `requisition ${s.key}`,
        run: async () => {
          const already = await prisma.purchaseRequest.findFirst({ where: { organizationId: O, description: { contains: poKey(s.key) } } });
          if (already) return;
          const pr: any = await ctx.as(s.requisition!.by, () =>
            requests.create({
              partnerId: supplierId.get(s.supplier),
              description: `${s.requisition!.note} · ${poKey(s.key)}`,
              neededBy: eat(s.day, '09:00').toISOString(),
              lines: s.lines.map(([code, qty]) => ({
                productId: store.productId(code),
                description: store.item(code).name,
                quantity: qty,
                estimatedUnitPrice: store.item(code).cost,
              })),
            }),
          );
          await ctx.as(s.requisition!.by, () => requests.submit(pr.id));
          await ctx.as('head', () => requests.approve(pr.id));
          await stamp(prisma, 'purchaseRequest', pr.id, eat(weekday(addDaysIso(s.day, -4)), '09:30'));
        },
      });
    }

    tl.add({
      at: eat(s.day, '10:30'),
      priority: 21,
      label: `purchase order ${s.key}`,
      run: async () => {
        if (await findPO(s.key)) return;
        const pr = s.requisition
          ? await prisma.purchaseRequest.findFirst({ where: { organizationId: O, description: { contains: poKey(s.key) }, status: 'approved' } })
          : null;
        const po: any = await ctx.as('bursar', () =>
          orders.create({
            partnerId: supplierId.get(s.supplier),
            description: s.title,
            notes: `${SUPPLIERS[s.supplier].name} · ${poKey(s.key)}`,
            currencyCode: 'UGX',
            paymentType: 'credit',
            warehouseId: store.location(s.warehouse),
            expectedDeliveryDate: eat(addDaysIso(s.day, s.deliverLag ?? 14), '10:00').toISOString(),
            terms: s.terms,
            requestId: pr?.id,
            lines: s.lines.map(([code, qty]) => ({
              productId: store.productId(code),
              description: store.item(code).name,
              quantity: qty,
              unitPrice: store.item(code).cost,
              unitOfMeasureId: undefined,
            })),
          }),
        );
        if (pr) await prisma.purchaseRequest.update({ where: { id: pr.id }, data: { status: 'converted' } });
        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { orderDate: eat(s.day, '10:30'), createdAt: eat(s.day, '10:30') } });
        return po;
      },
    });

    if (s.cancelled) {
      const day = weekday(addDaysIso(s.day, 6));
      if (day <= ctx.asOf) {
        tl.add({
          at: eat(day, '11:00'),
          priority: 22,
          label: `cancel PO ${s.key}`,
          run: async () => {
            const po = await findPO(s.key);
            if (!po || po.status === 'cancelled') return;
            // cancel() replaces the notes, so the idempotency key travels with
            // the reason or a re-run would raise the order again.
            await ctx.as('head', () => orders.cancel(po.id, `${s.cancelled} · ${poKey(s.key)}`));
          },
        });
      }
      continue;
    }

    if (s.deliverLag === null) continue;
    const deliveryDay = weekday(addDaysIso(s.day, s.deliverLag));
    if (deliveryDay > ctx.asOf) continue;
    tl.add({
      at: eat(deliveryDay, '09:00'),
      priority: 22,
      label: `goods received ${s.key}`,
      run: async () => {
        const po = await findPO(s.key);
        if (!po || !['active', 'partially_received'].includes(po.status)) return;
        // One delivery per order: a part delivery must stay part-delivered, so a
        // re-run must not quietly receive the balance.
        if (await prisma.goodsReceiptNote.findFirst({ where: { organizationId: O, purchaseOrderId: po.id } })) return;
        const part = s.deliverPart ?? 1;
        const lines = po.lines
          .map((l) => {
            const ordered = Number(l.quantity);
            const outstanding = ordered - Number(l.receivedQuantity);
            const qty = part >= 1 ? outstanding : Math.max(1, Math.round(ordered * part));
            return { purchaseOrderLineId: l.id, productId: l.productId ?? undefined, description: l.description, quantity: Math.min(qty, outstanding), unitCost: Number(l.unitPrice) };
          })
          .filter((l) => l.quantity > 0);
        if (lines.length === 0) return;
        await ctx.as('bursar', () =>
          orders.receive(po.id, {
            warehouseId: store.location(s.warehouse),
            receivedAt: eat(deliveryDay, '09:00').toISOString(),
            notes: `Delivery note from ${SUPPLIERS[s.supplier].name}`,
            lines,
          }),
        );
      },
    });

    if (s.payLag === null) continue;
    const payDay = weekday(addDaysIso(deliveryDay, s.payLag));
    if (payDay > ctx.asOf) continue;
    tl.add({
      at: eat(payDay, '14:30'),
      priority: 23,
      label: `pay supplier ${s.key}`,
      run: async () => {
        const po = await findPO(s.key);
        if (!po || po.paymentStatus === 'paid' || po.status === 'cancelled') return;
        // A supplier is paid for what was delivered, not what was ordered: on a
        // part delivery only the received value has been accrued as a payable.
        const delivered = po.lines.reduce((sum, l) => sum + Number(l.receivedQuantity) * Number(l.unitPrice), 0);
        const due = Math.min(delivered, Number(po.totalAmount)) - Number(po.totalPaid);
        if (due <= 0) return;
        const r = rng(`popay:${s.key}`);
        const method = r() < 0.75 ? 'bank' : 'cash';
        await ctx.as('bursar', () =>
          orders.pay(po.id, {
            amount: due,
            paidAt: eat(payDay, '14:30').toISOString(),
            method: method as 'bank' | 'cash',
            reference: method === 'bank' ? `EFT ${payDay.replace(/-/g, '')}${int(r, 10, 99)}` : `Cash voucher ${int(r, 400, 980)}`,
            notes: `Settlement of ${s.title}`,
          }),
        );
      },
    });
    void total;
  }

  // A requisition the head teacher turned down.
  tl.add({
    at: eat('2026-06-23', '10:00'),
    priority: 20,
    label: 'requisition rejected (projector)',
    run: async () => {
      const marker = 'demo:pr:projector-rejected';
      if (await prisma.purchaseRequest.findFirst({ where: { organizationId: O, description: { contains: marker } } })) return;
      const pr: any = await ctx.as('dos', () =>
        requests.create({
          description: `Projector and screen for the P.7 revision room · ${marker}`,
          neededBy: eat('2026-07-13', '09:00').toISOString(),
          lines: [{ description: 'Epson projector EB-X06 with tripod screen', quantity: 1, estimatedUnitPrice: 2_950_000 }],
        }),
      );
      await ctx.as('dos', () => requests.submit(pr.id));
      await ctx.as('head', () => requests.reject(pr.id, 'Not in this term’s budget; resubmit for the 2027 capital plan.'));
      await stamp(prisma, 'purchaseRequest', pr.id, eat('2026-06-23', '10:00'));
    },
  });

  // A requisition approved and still waiting for a supplier quotation.
  tl.add({
    at: eat('2026-09-29', '09:45'),
    priority: 20,
    label: 'requisition pending (science kits)',
    run: async () => {
      const marker = 'demo:pr:science-kits';
      if (await prisma.purchaseRequest.findFirst({ where: { organizationId: O, description: { contains: marker } } })) return;
      const pr: any = await ctx.as('dos', () =>
        requests.create({
          description: `Primary science demonstration kits for P.5–P.7 · ${marker}`,
          neededBy: eat('2026-10-26', '09:00').toISOString(),
          lines: [
            { description: 'Science demonstration kit (electricity & magnetism)', quantity: 3, estimatedUnitPrice: 780_000 },
            { description: 'Human body charts, laminated set', quantity: 4, estimatedUnitPrice: 145_000 },
          ],
        }),
      );
      await ctx.as('dos', () => requests.submit(pr.id));
      await ctx.as('head', () => requests.approve(pr.id));
      await stamp(prisma, 'purchaseRequest', pr.id, eat('2026-09-29', '09:45'));
    },
  });

  // ── 4. Debit notes: a short delivery and goods sent back ─────────────────
  const notes: Array<{ key: string; day: string; supplier: keyof typeof SUPPLIERS; reason: 'returned_goods'; note: string; location?: string; lines: Array<[string, number]> }> = [
    {
      key: 'uniform-wrong-size',
      day: '2026-05-13',
      supplier: 'UNIFORM',
      reason: 'returned_goods',
      note: 'Twenty primary uniform sets delivered in the wrong size (size 8 instead of size 12) and returned to the tailor.',
      location: 'STORE-SCHOL',
      lines: [['STK-UNI-PRI', 20]],
    },
    {
      key: 'tissue-damaged',
      day: '2026-06-09',
      supplier: 'CLEAN',
      reason: 'returned_goods',
      note: 'Forty rolls of toilet paper arrived soaked and were returned to CleanPro for credit.',
      location: 'STORE-CLEAN',
      lines: [['STK-TISSUE', 40]],
    },
    {
      key: 'ors-expired',
      day: '2026-08-25',
      supplier: 'PHARMACY',
      reason: 'returned_goods',
      note: 'ORS sachets delivered with four months to expiry were returned to the pharmacy for replacement.',
      location: 'STORE-SICK',
      lines: [['STK-ORS', 24]],
    },
  ];
  for (const n of notes) {
    if (n.day > ctx.asOf) continue;
    tl.add({
      at: eat(n.day, '11:30'),
      priority: 24,
      label: `debit note ${n.key}`,
      run: async () => {
        const marker = `demo:dn:${n.key}`;
        if (await prisma.debitNote.findFirst({ where: { organizationId: O, notes: { contains: marker } } })) return;
        // Only return what the store still holds.
        const lines: Array<{ productId: string; description: string; quantity: number; unitPrice: number }> = [];
        for (const [code, qty] of n.lines) {
          const item = store.item(code);
          let available = qty;
          if (n.location) {
            const si = await prisma.stockItem.findFirst({ where: { organizationId: O, productId: store.productId(code), locationId: store.location(n.location) } });
            available = Math.min(qty, Math.floor(Number(si?.quantity ?? 0)));
          }
          if (available <= 0) continue;
          lines.push({ productId: store.productId(code), description: item.name, quantity: available, unitPrice: item.cost });
        }
        if (lines.length === 0) return;
        const note: any = await ctx.as('bursar', () =>
          debitNotes.create({
            direction: 'inbound',
            partnerId: supplierId.get(n.supplier),
            reason: n.reason,
            reasonNote: n.note,
            issueDate: eat(n.day, '11:30').toISOString(),
            currencyCode: 'UGX',
            notes: `${n.note} · ${marker}`,
            locationId: n.location ? store.location(n.location) : undefined,
            lines,
          }),
        );
        await ctx.as('head', () => debitNotes.post(note.id));
      },
    });
  }

  // ── 5. Service suppliers: vendor bills and supplier payments ─────────────
  for (const b of SERVICE_BILLS) {
    if (b.day > ctx.asOf) continue;
    tl.add({
      at: eat(b.day, '11:00'),
      priority: 25,
      label: `vendor bill ${b.key}`,
      run: async () => {
        const marker = `demo:bill:${b.key}`;
        const existing = await prisma.document.findFirst({ where: { organizationId: O, documentType: 'vendor_bill', reference: marker } });
        if (existing) return;
        const bill: any = await ctx.as('accounts', () =>
          bills.create({
            partnerId: supplierId.get(b.supplier.code)!,
            issueDate: eat(b.day, '09:00').toISOString(),
            dueDate: eat(addDaysIso(b.day, b.dueDays), '09:00').toISOString(),
            reference: marker,
            notes: b.description,
            lines: [
              {
                description: b.description,
                quantity: 1,
                unitPrice: b.amount,
                accountId: books.account(b.account),
              },
            ],
          }),
        );
        await ctx.as('head', () => bills.post(bill.id, { overrideApproval: true }));
      },
    });
    if (b.payLag === null) continue;
    const payDay = weekday(addDaysIso(b.day, b.payLag));
    if (payDay > ctx.asOf) continue;
    tl.add({
      at: eat(payDay, '15:00'),
      priority: 26,
      label: `supplier payment ${b.key}`,
      run: async () => {
        const bill = await prisma.document.findFirst({ where: { organizationId: O, documentType: 'vendor_bill', reference: `demo:bill:${b.key}` } });
        if (!bill || Number(bill.amountResidual) <= 0) return;
        const r = rng(`billpay:${b.key}`);
        const method = pick(['bank', 'bank', 'cheque'], r) as 'bank' | 'cheque';
        await ctx.as('bursar', () =>
          payments.createSupplierPayment({
            partnerId: bill.partnerId!,
            paymentDate: eat(payDay, '15:00').toISOString(),
            amount: Number(bill.amountResidual),
            paymentMethod: method,
            accountId: books.account('1200'),
            reference: method === 'cheque' ? `CHQ ${int(r, 100_400, 100_999)}` : `EFT ${payDay.replace(/-/g, '')}${int(r, 10, 99)}`,
            allocations: [{ documentId: bill.id, amount: Number(bill.amountResidual) }],
          }),
        );
      },
    });
  }

  ok(`purchasing: ${Object.keys(SUPPLIERS).length} goods suppliers, ${specs.length} purchase orders, ${requisitions} requisitions, ${notes.length} debit notes, ${SERVICE_BILLS.length} service bills`);
  log('purchasing tail: 2 part deliveries, 3 unpaid invoices, 1 cancelled order, 1 rejected requisition, 2 bills still open');
}

/** Rows the database dated "now": give them the business date. */
async function stamp(prisma: Ctx['prisma'], model: 'purchaseRequest', id: string, at: Date): Promise<void> {
  await (prisma[model] as any).update({ where: { id }, data: { createdAt: at, updatedAt: at } });
}

function weekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, 1);
  return d;
}
