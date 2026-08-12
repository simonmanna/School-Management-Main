/** DTOs for Examinations sprint. */

export interface CreateExamTypeDto {
  name: string;
  weight: number;
  isFinal?: boolean;
}
export type UpdateExamTypeDto = Partial<CreateExamTypeDto>;

export interface CreateExamDto {
  termId: string;
  examTypeId: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  /** Class IDs the exam applies to. */
  classes: string[];
}
export type UpdateExamDto = Partial<CreateExamDto>;

export interface CreateExamScheduleDto {
  examId: string;
  classId: string;
  subjectId: string;
  date: Date | string;
  startTime: string; // 'HH:mm'
  durationMinutes?: number;
  invigilatorId?: string;
  maxMarks?: number;
}
export type UpdateExamScheduleDto = Partial<CreateExamScheduleDto>;

export interface BulkGradeEntryDto {
  examScheduleId: string;
  entries: Array<{
    studentProfileId: string;
    marksObtained: number;
    maxMarks?: number;
    remarks?: string;
  }>;
}
export interface GradeEntryUpdateDto {
  marksObtained?: number;
  maxMarks?: number;
  remarks?: string;
}

export interface CreateGradingScaleDto {
  name: string;
  /** [{min:0, max:39, grade:'F', gpa:0}, ...] */
  bands: Array<{ min: number; max: number; grade: string; gpa: number; remark?: string }>;
  isDefault?: boolean;
}
export type UpdateGradingScaleDto = Partial<CreateGradingScaleDto>;

export interface GenerateReportCardDto {
  studentProfileId: string;
  termId: string;
}