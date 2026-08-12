/** DTOs for Attendance + LMS sprint. */

export interface BulkMarkAttendanceDto {
  date: Date | string;
  classId: string;
  sectionId?: string;
  entries: Array<{
    studentProfileId: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    minutesLate?: number;
    reason?: string;
  }>;
}

export interface CreateHomeworkDto {
  classId: string;
  sectionId?: string;
  subjectId: string;
  termId?: string;
  title: string;
  description?: string;
  dueDate: Date | string;
  attachments?: Array<{ name: string; url: string }>;
  maxScore?: number;
}
export type UpdateHomeworkDto = Partial<CreateHomeworkDto>;

export interface SubmitHomeworkDto {
  assignmentId: string;
  content?: string;
  attachments?: Array<{ name: string; url: string }>;
}
export interface GradeSubmissionDto {
  submissionId: string;
  score: number;
  feedback?: string;
}

export interface CreateLearningResourceDto {
  classId?: string;
  subjectId?: string;
  title: string;
  type: 'note' | 'video' | 'link' | 'file' | 'slide';
  url?: string;
  fileUrl?: string;
  tags?: string[];
  description?: string;
}
export type UpdateLearningResourceDto = Partial<CreateLearningResourceDto>;

export interface CreateAnnouncementDto {
  scope: 'school' | 'campus' | 'department' | 'class' | 'staff';
  scopeId?: string;
  classId?: string;
  title: string;
  body: string;
  priority?: 'normal' | 'urgent' | 'info';
  audience?: Array<'all' | 'parents' | 'students' | 'staff'>;
  publishedAt?: Date | string;
  expiresAt?: Date | string;
}
export type UpdateAnnouncementDto = Partial<CreateAnnouncementDto>;