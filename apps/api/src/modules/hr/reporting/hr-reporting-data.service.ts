import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { dec, sum, ZERO, type Money } from '../../../kernel/common/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The canonical read layer for HR reporting.
 *
 * Report definitions are DATA and are handed no Prisma client (see
 * `ReportContext`), so every figure a definition prints comes from a method
 * here. That is deliberate: a definition that could reach the database would
 * eventually re-derive net pay its own way, and the register would stop tying
 * to the payslips it claims to summarise.
 *
 * Nothing in this file computes payroll. It reads what `HrPayrollService`
 * already stored — the register, the PAYE return and the bank schedule are
 * three presentations of the SAME `HrPayrollItem` rows, which is what makes
 * them reconcile by construction.
 */
@Injectable()
export class HrReportingDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  private get orgId(): string {
    return this.tenant.organizationId;
  }

  private static num(v: any): number {
    return v === null || v === undefined ? 0 : Number(v);
  }

  private static fullName(e: any): string {
    return `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim() || (e?.employeeCode ?? '');
  }

  // ── Payroll ────────────────────────────────────────────────────────────────

  /**
   * Resolve which run a payroll report is about.
   *
   * A run id wins. Given only a period, the LATEST non-reversed run for it is
   * used — reporting on a reversed run would print figures the ledger has
   * already backed out.
   */
  async resolveRun(params: { payrollRunId?: string; payrollPeriodId?: string }) {
    if (params.payrollRunId) {
      const run = await this.db.hrPayrollRun.findFirst({
        where: { id: params.payrollRunId, organizationId: this.orgId, deletedAt: null },
        include: { period: true },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      return run;
    }
    if (params.payrollPeriodId) {
      const run = await this.db.hrPayrollRun.findFirst({
        where: {
          periodId: params.payrollPeriodId,
          organizationId: this.orgId,
          deletedAt: null,
          status: { not: 'REVERSED' },
        },
        include: { period: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!run) throw new NotFoundException('No payroll run found for that period');
      return run;
    }
    // Neither given: the most recent run that still stands.
    const run = await this.db.hrPayrollRun.findFirst({
      where: { organizationId: this.orgId, deletedAt: null, status: { not: 'REVERSED' } },
      include: { period: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) throw new NotFoundException('No payroll run has been calculated yet');
    return run;
  }

  /** Every payroll item of a run, with the employee and org structure joined. */
  private async itemsOfRun(runId: string, filters: { departmentId?: string; employeeId?: string } = {}) {
    return this.db.hrPayrollItem.findMany({
      where: {
        runId,
        organizationId: this.orgId,
        deletedAt: null,
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.departmentId ? { employee: { departmentId: filters.departmentId } } : {}),
      },
      include: {
        employee: {
          select: {
            id: true, employeeCode: true, firstName: true, lastName: true,
            taxNumber: true, pensionNumber: true, socialSecurityNumber: true,
            bankName: true, bankAccountName: true, bankAccountNumber: true,
            mobileMoneyProvider: true, mobileMoneyNumber: true,
            employmentType: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, title: true } },
          },
        },
        allowances: true,
        deductions: true,
        payslip: { select: { payslipNumber: true, status: true, paidAt: true } },
      },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
  }

  /** The payroll register — one row per employee, every column of the payslip. */
  async payrollRegister(params: {
    payrollRunId?: string; payrollPeriodId?: string; departmentId?: string; employeeId?: string;
  }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id, params);
    const N = HrReportingDataService.num;
    return {
      run,
      rows: items.map((i: any) => ({
        employeeCode: i.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(i.employee),
        department: i.employee?.department?.name ?? '',
        position: i.employee?.position?.title ?? '',
        payslipNumber: i.payslip?.payslipNumber ?? '',
        paidDays: N(i.paidDays),
        periodDays: N(i.periodDays),
        proRata: N(i.proRataFactor),
        unpaidLeaveDays: N(i.unpaidLeaveDays),
        basicPay: N(i.baseSalary),
        overtimePay: N(i.overtimePay),
        allowances: N(i.allowancesTotal),
        bonus: N(i.bonusAmount),
        commission: N(i.commissionAmount),
        grossPay: N(i.grossPay),
        paye: N(i.taxAmount),
        pension: N(i.pensionAmount),
        socialSecurity: N(i.socialSecurityAmount),
        insurance: N(i.insuranceAmount),
        loanRepayment: N(i.loanDeduction),
        advanceRepayment: N(i.advanceDeduction),
        otherDeductions: N(i.otherDeductions),
        totalDeductions: N(i.totalDeductions),
        netPay: N(i.netPay),
      })),
    };
  }

  /**
   * PAYE return — one line per employee with the figures a revenue authority
   * asks for. Employees with no tax are still listed: a nil return line is
   * evidence the employee was considered, an omission is not.
   */
  async payeReturn(params: { payrollRunId?: string; payrollPeriodId?: string; departmentId?: string }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id, params);
    const N = HrReportingDataService.num;
    return {
      run,
      rows: items.map((i: any) => {
        // The PAYE base is gross less the statutory contributions that are
        // deductible before tax — recomputing it here from stored figures keeps
        // the return tied to the payslip rather than to a second calculation.
        const chargeable = N(i.grossPay) - N(i.pensionAmount) - N(i.socialSecurityAmount);
        return {
          employeeCode: i.employee?.employeeCode ?? '',
          employeeName: HrReportingDataService.fullName(i.employee),
          taxNumber: i.employee?.taxNumber ?? '',
          department: i.employee?.department?.name ?? '',
          grossPay: N(i.grossPay),
          pension: N(i.pensionAmount),
          socialSecurity: N(i.socialSecurityAmount),
          chargeableIncome: chargeable > 0 ? chargeable : 0,
          payeDue: N(i.taxAmount),
        };
      }),
    };
  }

  /** Pension / social-security schedule — employee number, wage, contribution. */
  async statutorySchedule(params: {
    payrollRunId?: string; payrollPeriodId?: string; departmentId?: string;
  }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id, params);
    const N = HrReportingDataService.num;
    return {
      run,
      rows: items
        .filter((i: any) => N(i.pensionAmount) > 0 || N(i.socialSecurityAmount) > 0)
        .map((i: any) => ({
          employeeCode: i.employee?.employeeCode ?? '',
          employeeName: HrReportingDataService.fullName(i.employee),
          socialSecurityNumber: i.employee?.socialSecurityNumber ?? '',
          pensionNumber: i.employee?.pensionNumber ?? '',
          grossPay: N(i.grossPay),
          pension: N(i.pensionAmount),
          socialSecurity: N(i.socialSecurityAmount),
          total: N(i.pensionAmount) + N(i.socialSecurityAmount),
        })),
    };
  }

  /**
   * Bank payment schedule — what the bank is actually asked to move.
   *
   * Rows with no destination account are still returned, flagged, because the
   * failure mode this report exists to catch is an employee who will silently
   * not be paid.
   */
  async bankSchedule(params: {
    payrollRunId?: string; payrollPeriodId?: string; departmentId?: string;
  }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id, params);
    const N = HrReportingDataService.num;
    return {
      run,
      rows: items.map((i: any) => {
        const e = i.employee ?? {};
        const hasBank = !!e.bankAccountNumber;
        const hasMomo = !!e.mobileMoneyNumber;
        return {
          employeeCode: e.employeeCode ?? '',
          employeeName: HrReportingDataService.fullName(e),
          method: hasBank ? 'BANK' : hasMomo ? 'MOBILE_MONEY' : 'UNSET',
          bankName: e.bankName ?? '',
          accountName: e.bankAccountName ?? '',
          accountNumber: e.bankAccountNumber ?? e.mobileMoneyNumber ?? '',
          netPay: N(i.netPay),
          status: hasBank || hasMomo ? 'ready' : 'NO PAYMENT DETAILS',
        };
      }),
    };
  }

  /** Payroll cost grouped by department — what the run cost each cost centre. */
  async payrollCostByDepartment(params: { payrollRunId?: string; payrollPeriodId?: string }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id);
    const N = HrReportingDataService.num;
    const byDept = new Map<string, any>();
    for (const i of items) {
      const key = i.employee?.department?.name ?? '(unassigned)';
      const acc = byDept.get(key) ?? {
        department: key, headcount: 0, grossPay: 0, paye: 0,
        statutory: 0, otherDeductions: 0, netPay: 0,
      };
      acc.headcount += 1;
      acc.grossPay += N(i.grossPay);
      acc.paye += N(i.taxAmount);
      acc.statutory += N(i.pensionAmount) + N(i.socialSecurityAmount);
      acc.otherDeductions += N(i.otherDeductions) + N(i.insuranceAmount);
      acc.netPay += N(i.netPay);
      byDept.set(key, acc);
    }
    return { run, rows: [...byDept.values()].sort((a, b) => b.grossPay - a.grossPay) };
  }

  /**
   * Period-on-period variance.
   *
   * The comparison run is the previous non-reversed run by period start date,
   * so "why is payroll up 4m this month" is answerable per employee. A joiner
   * shows as a nil prior; a leaver as a nil current — both are the answer.
   */
  async payrollVariance(params: { payrollRunId?: string; payrollPeriodId?: string }) {
    const run = await this.resolveRun(params);
    const prior = await this.db.hrPayrollRun.findFirst({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        status: { not: 'REVERSED' },
        id: { not: run.id },
        period: { startDate: { lt: run.period.startDate } },
      },
      include: { period: true },
      orderBy: { period: { startDate: 'desc' } },
    });

    const [current, previous] = await Promise.all([
      this.itemsOfRun(run.id),
      prior ? this.itemsOfRun(prior.id) : Promise.resolve([]),
    ]);
    const N = HrReportingDataService.num;
    const priorBy = new Map<string, any>(previous.map((i: any) => [i.employeeId, i]));
    const seen = new Set<string>();
    const rows: any[] = [];

    for (const i of current) {
      seen.add(i.employeeId);
      const p = priorBy.get(i.employeeId);
      const now = N(i.netPay);
      const then = p ? N(p.netPay) : 0;
      rows.push({
        employeeCode: i.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(i.employee),
        department: i.employee?.department?.name ?? '',
        priorNet: then,
        currentNet: now,
        variance: now - then,
        variancePct: then === 0 ? null : ((now - then) / then) * 100,
        note: p ? '' : 'new this period',
      });
    }
    // Leavers: on the prior run, absent from this one.
    for (const p of previous) {
      if (seen.has(p.employeeId)) continue;
      const then = N(p.netPay);
      rows.push({
        employeeCode: p.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(p.employee),
        department: p.employee?.department?.name ?? '',
        priorNet: then,
        currentNet: 0,
        variance: -then,
        variancePct: then === 0 ? null : -100,
        note: 'not on this run',
      });
    }
    return { run, prior, rows: rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)) };
  }

  // ── Workforce ──────────────────────────────────────────────────────────────

  /** Active headcount with the fields an establishment return asks for. */
  async headcount(params: { departmentId?: string; positionId?: string; employmentType?: string }) {
    const rows = await this.db.hrEmployee.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        isActive: true,
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
        ...(params.positionId ? { positionId: params.positionId } : {}),
        ...(params.employmentType ? { employmentType: params.employmentType } : {}),
      },
      select: {
        employeeCode: true, firstName: true, lastName: true, gender: true,
        employmentType: true, hireDate: true, email: true, phone: true,
        dateOfBirth: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
        supervisor: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ department: { name: 'asc' } }, { employeeCode: 'asc' }],
    });
    const today = new Date();
    return rows.map((e: any) => ({
      employeeCode: e.employeeCode,
      employeeName: HrReportingDataService.fullName(e),
      department: e.department?.name ?? '',
      position: e.position?.title ?? '',
      employmentType: e.employmentType,
      gender: e.gender ?? '',
      hireDate: e.hireDate,
      yearsOfService: e.hireDate ? yearsBetween(e.hireDate, today) : null,
      age: e.dateOfBirth ? yearsBetween(e.dateOfBirth, today) : null,
      supervisor: e.supervisor ? HrReportingDataService.fullName(e.supervisor) : '',
      email: e.email ?? '',
      phone: e.phone ?? '',
    }));
  }

  /**
   * Contracts running out inside the window.
   *
   * A school's staffing risk is concentrated here: a teacher whose contract
   * lapses mid-term cannot legally be timetabled, and nobody notices until the
   * term starts.
   */
  async contractsExpiring(params: { dateFrom?: string; dateTo?: string; departmentId?: string }) {
    const from = params.dateFrom ? new Date(params.dateFrom) : new Date();
    const to = params.dateTo
      ? new Date(params.dateTo)
      : new Date(from.getTime() + 90 * 86_400_000);
    const rows = await this.db.hrContract.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        endDate: { gte: from, lte: to },
        status: { notIn: ['terminated', 'expired'] },
        ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true, email: true, phone: true,
            department: { select: { name: true } },
            position: { select: { title: true } },
          },
        },
      },
      orderBy: { endDate: 'asc' },
    });
    const today = new Date();
    return rows.map((c: any) => ({
      employeeCode: c.employee?.employeeCode ?? '',
      employeeName: HrReportingDataService.fullName(c.employee),
      department: c.employee?.department?.name ?? '',
      position: c.employee?.position?.title ?? '',
      contractType: c.contractType ?? '',
      startDate: c.startDate,
      endDate: c.endDate,
      daysRemaining: Math.ceil((new Date(c.endDate).getTime() - today.getTime()) / 86_400_000),
      status: c.status ?? '',
      phone: c.employee?.phone ?? '',
    }));
  }

  /** Certifications and licences lapsing — teaching licences above all. */
  async certificationsExpiring(params: { dateFrom?: string; dateTo?: string; departmentId?: string }) {
    const from = params.dateFrom ? new Date(params.dateFrom) : new Date();
    const to = params.dateTo
      ? new Date(params.dateTo)
      : new Date(from.getTime() + 90 * 86_400_000);
    const rows = await this.db.hrCertification.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        expiryDate: { gte: from, lte: to },
        ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { expiryDate: 'asc' },
    });
    const today = new Date();
    return rows.map((c: any) => ({
      employeeCode: c.employee?.employeeCode ?? '',
      employeeName: HrReportingDataService.fullName(c.employee),
      department: c.employee?.department?.name ?? '',
      certification: c.name ?? '',
      issuingBody: c.issuingBody ?? '',
      issueDate: c.issueDate,
      expiryDate: c.expiryDate,
      daysRemaining: Math.ceil((new Date(c.expiryDate).getTime() - today.getTime()) / 86_400_000),
      status: c.status ?? '',
    }));
  }

  /** Leave entitlement, taken and remaining, per employee per leave type. */
  async leaveBalances(params: { departmentId?: string; employeeId?: string }) {
    const year = new Date().getFullYear();
    const rows = await this.db.hrLeaveBalance.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        year,
        ...(params.employeeId ? { employeeId: params.employeeId } : {}),
        ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            department: { select: { name: true } },
          },
        },
        leaveType: { select: { code: true, name: true, isPaid: true } },
      },
      orderBy: [{ employee: { employeeCode: 'asc' } }],
    });
    const N = HrReportingDataService.num;
    return rows.map((b: any) => ({
      employeeCode: b.employee?.employeeCode ?? '',
      employeeName: HrReportingDataService.fullName(b.employee),
      department: b.employee?.department?.name ?? '',
      leaveType: b.leaveType?.name ?? '',
      paid: b.leaveType?.isPaid ? 'Paid' : 'Unpaid',
      accrued: N(b.accruedDays),
      adjusted: N(b.adjustedDays),
      used: N(b.usedDays),
      remaining: N(b.accruedDays) + N(b.adjustedDays) - N(b.usedDays),
    }));
  }

  /** Leave taken/requested in a window — the term leave diary. */
  async leaveRegister(params: {
    dateFrom?: string; dateTo?: string; departmentId?: string; employeeId?: string; status?: string[];
  }) {
    const from = params.dateFrom ? new Date(params.dateFrom) : undefined;
    const to = params.dateTo ? new Date(params.dateTo) : undefined;
    const rows = await this.db.hrLeaveRequest.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        ...(params.status?.length ? { status: { in: params.status } } : {}),
        ...(params.employeeId ? { employeeId: params.employeeId } : {}),
        ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
        // Overlap, not containment: a request spanning the window's edge is
        // still leave taken during the window.
        ...(to ? { startDate: { lte: to } } : {}),
        ...(from ? { endDate: { gte: from } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            department: { select: { name: true } },
          },
        },
        leaveType: { select: { name: true, isPaid: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    return rows.map((r: any) => ({
      requestCode: r.requestCode,
      employeeCode: r.employee?.employeeCode ?? '',
      employeeName: HrReportingDataService.fullName(r.employee),
      department: r.employee?.department?.name ?? '',
      leaveType: r.leaveType?.name ?? '',
      paid: r.leaveType?.isPaid ? 'Paid' : 'Unpaid',
      startDate: r.startDate,
      endDate: r.endDate,
      days: HrReportingDataService.num(r.days),
      status: r.status,
      reason: r.reason ?? '',
    }));
  }

  /** Daily attendance rolled up per employee for a window. */
  async attendanceSummary(params: {
    dateFrom?: string; dateTo?: string; departmentId?: string; employeeId?: string;
  }) {
    const from = params.dateFrom ? new Date(params.dateFrom) : new Date(Date.now() - 30 * 86_400_000);
    const to = params.dateTo ? new Date(params.dateTo) : new Date();
    const rows = await this.db.hrAttendance.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        date: { gte: from, lte: to },
        ...(params.employeeId ? { employeeId: params.employeeId } : {}),
        ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
      },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    const by = new Map<string, any>();
    for (const a of rows) {
      const key = a.employeeId;
      const acc = by.get(key) ?? {
        employeeCode: a.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(a.employee),
        department: a.employee?.department?.name ?? '',
        daysRecorded: 0, present: 0, absent: 0, late: 0, onLeave: 0,
        workedHours: 0, overtimeHours: 0,
      };
      acc.daysRecorded += 1;
      if (a.status === 'PRESENT') acc.present += 1;
      else if (a.status === 'ABSENT') acc.absent += 1;
      else if (a.status === 'LATE') { acc.late += 1; acc.present += 1; }
      else if (a.status === 'ON_LEAVE') acc.onLeave += 1;
      acc.workedHours += (a.workedMinutes ?? 0) / 60;
      acc.overtimeHours += (a.overtimeMinutes ?? 0) / 60;
      by.set(key, acc);
    }
    return [...by.values()]
      .map((r) => ({
        ...r,
        workedHours: Math.round(r.workedHours * 100) / 100,
        overtimeHours: Math.round(r.overtimeHours * 100) / 100,
        // Of the days actually recorded — a school that stops taking staff
        // attendance in the holidays must not show 0% attendance for December.
        attendanceRate: r.daysRecorded === 0 ? 0 : Math.round((r.present / r.daysRecorded) * 1000) / 10,
      }))
      .sort((a, b) => a.attendanceRate - b.attendanceRate);
  }

  /**
   * Joiners and leavers in a window, with the turnover rate.
   *
   * Rate is leavers over average headcount, the standard definition — using
   * closing headcount instead flatters a shrinking school.
   */
  async turnover(params: { dateFrom?: string; dateTo?: string; departmentId?: string }) {
    const from = params.dateFrom ? new Date(params.dateFrom) : new Date(new Date().getFullYear(), 0, 1);
    const to = params.dateTo ? new Date(params.dateTo) : new Date();
    const deptWhere = params.departmentId ? { departmentId: params.departmentId } : {};

    const [joiners, leavers, openingCount, closingCount] = await Promise.all([
      this.db.hrEmployee.findMany({
        where: { organizationId: this.orgId, deletedAt: null, hireDate: { gte: from, lte: to }, ...deptWhere },
        select: {
          employeeCode: true, firstName: true, lastName: true, hireDate: true,
          employmentType: true, department: { select: { name: true } },
          position: { select: { title: true } },
        },
      }),
      this.db.hrOffboarding.findMany({
        where: {
          organizationId: this.orgId, deletedAt: null,
          lastWorkingDay: { gte: from, lte: to },
          ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
        },
        include: {
          employee: {
            select: {
              employeeCode: true, firstName: true, lastName: true, hireDate: true,
              employmentType: true, department: { select: { name: true } },
              position: { select: { title: true } },
            },
          },
        },
      }),
      this.db.hrEmployee.count({
        where: {
          organizationId: this.orgId, deletedAt: null, ...deptWhere,
          OR: [{ hireDate: null }, { hireDate: { lt: from } }],
        },
      }),
      this.db.hrEmployee.count({
        where: { organizationId: this.orgId, deletedAt: null, isActive: true, ...deptWhere },
      }),
    ]);

    const rows = [
      ...joiners.map((e: any) => ({
        movement: 'Joiner',
        employeeCode: e.employeeCode,
        employeeName: HrReportingDataService.fullName(e),
        department: e.department?.name ?? '',
        position: e.position?.title ?? '',
        employmentType: e.employmentType,
        effectiveDate: e.hireDate,
        reason: '',
        tenureYears: null as number | null,
      })),
      ...leavers.map((o: any) => ({
        movement: 'Leaver',
        employeeCode: o.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(o.employee),
        department: o.employee?.department?.name ?? '',
        position: o.employee?.position?.title ?? '',
        employmentType: o.employee?.employmentType ?? '',
        effectiveDate: o.lastWorkingDay,
        reason: o.reason ?? '',
        tenureYears: o.employee?.hireDate
          ? yearsBetween(o.employee.hireDate, new Date(o.lastWorkingDay))
          : null,
      })),
    ].sort((a, b) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());

    const averageHeadcount = (openingCount + closingCount) / 2;
    return {
      rows,
      joiners: joiners.length,
      leavers: leavers.length,
      averageHeadcount,
      turnoverRate: averageHeadcount === 0
        ? 0
        : Math.round((leavers.length / averageHeadcount) * 1000) / 10,
      window: { from, to },
    };
  }

  /**
   * Employees who cannot be paid, or would be paid wrongly.
   *
   * This is the pre-flight check a bursar should run before every payroll. Each
   * finding is a specific, fixable defect — not a score.
   */
  async payrollReadiness(params: { departmentId?: string }) {
    const employees = await this.db.hrEmployee.findMany({
      where: {
        organizationId: this.orgId,
        deletedAt: null,
        isActive: true,
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      },
      select: {
        employeeCode: true, firstName: true, lastName: true, hireDate: true,
        baseSalary: true, hourlyRate: true, payFrequency: true,
        bankAccountNumber: true, mobileMoneyNumber: true, taxNumber: true,
        partnerId: true,
        department: { select: { name: true } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    const rows: any[] = [];
    for (const e of employees) {
      const issues: string[] = [];
      const hourly = e.payFrequency === 'HOURLY';
      if (!hourly && !HrReportingDataService.num(e.baseSalary)) issues.push('no base salary');
      if (hourly && !HrReportingDataService.num(e.hourlyRate)) issues.push('no hourly rate');
      if (!e.bankAccountNumber && !e.mobileMoneyNumber) issues.push('no bank or mobile money account');
      if (!e.taxNumber) issues.push('no tax number');
      if (!e.hireDate) issues.push('no hire date (pro-rata cannot be computed)');
      // Without a Partner the net-pay GL line carries no subledger dimension,
      // so the ledger can say what payroll cost but not what is owed to whom.
      if (!e.partnerId) issues.push('not linked to a partner (no per-employee ledger)');
      if (issues.length === 0) continue;
      rows.push({
        employeeCode: e.employeeCode,
        employeeName: HrReportingDataService.fullName(e),
        department: e.department?.name ?? '',
        issueCount: issues.length,
        issues: issues.join('; '),
      });
    }
    return { rows, totalActive: employees.length };
  }

  /** Salary spread by job grade — the pay-equity view. */
  async salaryByGrade(params: { departmentId?: string }) {
    const employees = await this.db.hrEmployee.findMany({
      where: {
        organizationId: this.orgId, deletedAt: null, isActive: true,
        ...(params.departmentId ? { departmentId: params.departmentId } : {}),
      },
      select: {
        baseSalary: true, gender: true,
        position: { select: { title: true, grade: { select: { code: true, name: true } } } },
      },
    });
    const by = new Map<string, any>();
    for (const e of employees) {
      const key = e.position?.grade?.name ?? '(no grade)';
      const acc = by.get(key) ?? {
        grade: key, headcount: 0, total: 0, min: Infinity, max: 0,
        male: 0, female: 0, maleTotal: 0, femaleTotal: 0,
      };
      const salary = HrReportingDataService.num(e.baseSalary);
      acc.headcount += 1;
      acc.total += salary;
      acc.min = Math.min(acc.min, salary);
      acc.max = Math.max(acc.max, salary);
      const g = (e.gender ?? '').toLowerCase();
      if (g === 'male') { acc.male += 1; acc.maleTotal += salary; }
      else if (g === 'female') { acc.female += 1; acc.femaleTotal += salary; }
      by.set(key, acc);
    }
    return [...by.values()].map((r) => {
      const maleAvg = r.male ? r.maleTotal / r.male : 0;
      const femaleAvg = r.female ? r.femaleTotal / r.female : 0;
      return {
        grade: r.grade,
        headcount: r.headcount,
        minSalary: r.min === Infinity ? 0 : r.min,
        avgSalary: r.headcount ? Math.round(r.total / r.headcount) : 0,
        maxSalary: r.max,
        totalCost: r.total,
        male: r.male,
        female: r.female,
        // Positive means men are paid more at this grade. Reported, not judged.
        genderPayGapPct: maleAvg === 0 || femaleAvg === 0
          ? null
          : Math.round(((maleAvg - femaleAvg) / maleAvg) * 1000) / 10,
      };
    }).sort((a, b) => b.totalCost - a.totalCost);
  }

  /** Money still owed by staff: outstanding loans and unrecovered advances. */
  async staffReceivables(params: { departmentId?: string; employeeId?: string }) {
    const where = {
      organizationId: this.orgId,
      deletedAt: null,
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
      ...(params.departmentId ? { employee: { departmentId: params.departmentId } } : {}),
    };
    const employeeSelect = {
      employeeCode: true, firstName: true, lastName: true,
      department: { select: { name: true } },
    };
    const [loans, advances] = await Promise.all([
      this.db.hrEmployeeLoan.findMany({
        where: { ...where, status: 'ACTIVE' },
        include: { employee: { select: employeeSelect } },
      }),
      this.db.hrSalaryAdvance.findMany({
        where: { ...where, status: { in: ['APPROVED', 'PAID'] } },
        include: { employee: { select: employeeSelect } },
      }),
    ]);
    const N = HrReportingDataService.num;
    const rows = [
      ...loans.map((l: any) => ({
        kind: 'Loan',
        reference: l.loanCode,
        employeeCode: l.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(l.employee),
        department: l.employee?.department?.name ?? '',
        principal: N(l.principal),
        installment: N(l.installmentAmount),
        installmentsPaid: l.installmentsPaid ?? 0,
        installmentsTotal: l.installmentsTotal ?? 0,
        balance: N(l.balance),
      })),
      ...advances.map((a: any) => ({
        kind: 'Advance',
        reference: a.advanceCode,
        employeeCode: a.employee?.employeeCode ?? '',
        employeeName: HrReportingDataService.fullName(a.employee),
        department: a.employee?.department?.name ?? '',
        principal: N(a.amount),
        installment: N(a.monthlyDeduction),
        installmentsPaid: 0,
        installmentsTotal: a.installmentMonths ?? 0,
        balance: N(a.balance),
      })),
    ].filter((r) => r.balance > 0);
    return rows.sort((a, b) => b.balance - a.balance);
  }

  /** Total workforce cost of a run, as one set of labelled figures. */
  async payrollSummary(params: { payrollRunId?: string; payrollPeriodId?: string }) {
    const run = await this.resolveRun(params);
    const items = await this.itemsOfRun(run.id);
    const total = (field: string): Money =>
      sum(items.map((i: any) => dec(i[field] ?? 0)));
    const netTotal = total('netPay');
    return {
      run,
      figures: {
        period: run.period?.periodCode ?? '',
        runNumber: run.runNumber,
        status: run.status,
        employees: items.length,
        grossPay: Number(total('grossPay')),
        allowances: Number(total('allowancesTotal')),
        overtime: Number(total('overtimePay')),
        bonuses: Number(total('bonusAmount')),
        paye: Number(total('taxAmount')),
        pension: Number(total('pensionAmount')),
        socialSecurity: Number(total('socialSecurityAmount')),
        loanRecoveries: Number(total('loanDeduction')),
        advanceRecoveries: Number(total('advanceDeduction')),
        totalDeductions: Number(total('totalDeductions')),
        netPay: Number(netTotal),
        averageNetPay: items.length === 0
          ? 0
          : Number(netTotal.dividedBy(dec(items.length)).toDecimalPlaces(2)),
      },
    };
  }
}

/** Whole years between two dates. Used for age and tenure alike. */
function yearsBetween(from: Date | string, to: Date): number {
  const f = from instanceof Date ? from : new Date(from);
  let years = to.getFullYear() - f.getFullYear();
  const monthDiff = to.getMonth() - f.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getDate() < f.getDate())) years -= 1;
  return years < 0 ? 0 : years;
}

/** Re-exported so definitions can format a zero without importing money. */
export const REPORT_ZERO = ZERO;
