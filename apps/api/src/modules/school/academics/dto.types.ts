/** DTOs for Academics sprint. */
export interface CreateCurriculumDto {
  classId: string;
  academicYearId: string;
  name: string;
  description?: string;
  subjects: Array<{ subjectId: string; periodsPerWeek: number; isCore?: boolean }>;
}
export type UpdateCurriculumDto = Partial<Omit<CreateCurriculumDto, 'subjects'>> & {
  subjects?: Array<{ subjectId: string; periodsPerWeek: number; isCore?: boolean }>;
};

export interface CreateLessonPlanDto {
  subjectId: string;
  classId?: string;
  termId?: string;
  teacherPartnerId?: string;
  weekOf: Date | string;
  title: string;
  objectives?: string;
  materials?: string;
}
export type UpdateLessonPlanDto = Partial<CreateLessonPlanDto>;

export interface CreateTeacherAssignmentDto {
  teacherPartnerId: string;
  subjectId: string;
  classId: string;
  sectionId?: string;
  termId?: string;
  periodsPerWeek?: number;
}
export type UpdateTeacherAssignmentDto = Partial<CreateTeacherAssignmentDto>;

export interface CreateTimetableSlotDto {
  classId: string;
  sectionId?: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherPartnerId?: string;
  campusId?: string;
  room?: string;
}
export interface BulkTimetableDto {
  classId: string;
  sectionId?: string;
  slots: Omit<CreateTimetableSlotDto, 'classId' | 'sectionId'>[];
}
export type UpdateTimetableSlotDto = Partial<CreateTimetableSlotDto>;
