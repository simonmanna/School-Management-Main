/** DTOs for the Fees sprint (Sprint 6 — keystone). */

export interface FeeComponent {
  code: string;            // 'TUITION', 'TRANSPORT', 'MEAL', 'LAB', 'EXAM', 'LIBRARY', 'ACTIVITY'
  productId: string;       // FK to Product (type=service)
  amount: number;
  isOptional?: boolean;
}

export interface CreateFeeStructureDto {
  name: string;
  academicYearId: string;
  components: FeeComponent[];
  /** {gradeLevelIds?:string[], classIds?:string[]} */
  applicableTo?: Record<string, unknown>;
  isActive?: boolean;
}
export type UpdateFeeStructureDto = Partial<CreateFeeStructureDto>;

export interface CreateFeeScheduleDto {
  feeStructureId: string;
  termId: string;
  dueDate: Date | string;
  lateFeePolicy?: { type: 'percent' | 'fixed'; value: number; graceDays: number };
}
export type UpdateFeeScheduleDto = Partial<CreateFeeScheduleDto>;

export interface CreateStudentFeeAssignmentDto {
  studentProfileId: string;
  feeStructureId: string;
  termId: string;
  /** Per-student override of components: {code: amount}. */
  customDiscount?: Record<string, number>;
  extraDiscounts?: Array<{ code: string; type: 'percent' | 'fixed'; value: number }>;
}
export type UpdateStudentFeeAssignmentDto = Partial<CreateStudentFeeAssignmentDto>;

export interface CreateDiscountDto {
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  appliesTo?: Record<string, unknown>;
  isActive?: boolean;
}
export type UpdateDiscountDto = Partial<CreateDiscountDto>;

export interface CreateScholarshipDto {
  studentProfileId: string;
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  validFrom: Date | string;
  validTo?: Date | string;
  awardedBy?: string;
  notes?: string;
}
export type UpdateScholarshipDto = Partial<CreateScholarshipDto>;

export type UpdateInstallmentPlanDto = Partial<CreateInstallmentPlanDto>;

export interface CreateInstallmentPlanDto {
  studentProfileId: string;
  termId: string;
  totalAmount: number;
  installments: Array<{ number: number; dueDate: Date | string; amount: number }>;
}

export interface CreatePenaltyRuleDto {
  feeScheduleId: string;
  type: 'percent' | 'fixed';
  value: number;
  graceDays?: number;
  isActive?: boolean;
}
export type UpdatePenaltyRuleDto = Partial<CreatePenaltyRuleDto>;

export interface GenerateBillingDto {
  termId: string;
  classId?: string; // generate for one class; otherwise all active students
}

export interface CollectFeePaymentDto {
  studentProfileId: string;
  amount: number;
  paymentMethod: 'cash' | 'bank' | 'mobile_money' | 'card';
  paymentDate?: Date | string;
  cashSessionId?: string;
  bankAccountId?: string;
  /** Optional document IDs to allocate against. If empty, allocates oldest-first. */
  documentIds?: string[];
  reference?: string;
  notes?: string;
}