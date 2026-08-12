/** DTOs for the Admissions + Academics sprint. */

export interface CreateApplicationDto {
  academicYearId: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantDob?: Date | string;
  applicantGender?: 'male' | 'female' | 'other';
  applyingForClassId?: string;
  parentContactId?: string;
  customFields?: Record<string, unknown>;
}
export type UpdateApplicationDto = Partial<CreateApplicationDto>;

export interface AddExamScoreDto {
  applicationId: string;
  subjectId: string;
  score: number;
  maxScore?: number;
  grade?: string;
  notes?: string;
}

export interface EnrollApplicationDto {
  applicationId: string;
  classId: string;
  sectionId?: string;
  termId: string;
  rollNumber: string;
  /** Partner-level data required to create the student. */
  student: {
    name: string;
    email?: string;
    phone?: string;
    dateOfBirth?: Date | string;
    gender?: 'male' | 'female' | 'other';
    nationality?: string;
    religion?: string;
    house?: string;
    residenceType?: 'day' | 'boarder';
  };
}

export interface CreateCurriculumDto {
  classId: string;
  academicYearId: string;
  name: string;
  description?: string;
  subjects: Array<{ subjectId: string; periodsPerWeek: number; isCore?: boolean }>;
}
export interface UpdateCurriculumDto extends Partial<Omit<CreateCurriculumDto, 'subjects'>> {
  subjects?: Array<{ subjectId: string; periodsPerWeek: number; isCore?: boolean }>;
}

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
  dayOfWeek: number; // 1=Mon ... 7=Sun
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