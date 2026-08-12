/** DTOs for the People sprint. */
export interface CreateStudentDto {
  /** Partner row data. */
  name: string;
  code?: string; // auto-generated if omitted
  email?: string;
  phone?: string;
  isCompany?: boolean;

  /** StudentProfile data. */
  admissionNo: string;
  enrollmentDate: Date | string;
  currentClassId?: string;
  currentSectionId?: string;
  dateOfBirth?: Date | string;
  gender?: 'male' | 'female' | 'other';
  nationality?: string;
  religion?: string;
  residenceType?: 'day' | 'boarder';
  house?: string;
  customFields?: Record<string, unknown>;
}
export type UpdateStudentDto = Partial<CreateStudentDto> & {
  status?: 'active' | 'suspended' | 'transferred' | 'withdrawn' | 'alumni';
  reason?: string;
};

export interface CreateGuardianDto {
  studentProfileId: string;
  /** Contact row to create or reuse. */
  guardian: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    position?: string;
  };
  relationship: 'father' | 'mother' | 'uncle' | 'aunt' | 'sibling' | 'grandparent' | 'guardian' | 'other';
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
}
export interface UpdateGuardianDto {
  relationship?: 'father' | 'mother' | 'uncle' | 'aunt' | 'sibling' | 'grandparent' | 'guardian' | 'other';
  isPrimary?: boolean;
  canPickup?: boolean;
  receivesStatements?: boolean;
}

export interface UpsertMedicalRecordDto {
  studentProfileId: string;
  bloodGroup?: string;
  allergies?: string[];
  conditions?: string[];
  medications?: string[];
  emergencyNotes?: string;
  doctorName?: string;
  doctorPhone?: string;
}

export interface CreateStudentDocumentDto {
  studentProfileId: string;
  type: 'birth_cert' | 'report_card' | 'transfer_letter' | 'photo' | 'medical' | 'other';
  title: string;
  fileUrl: string;
  expiresAt?: Date | string;
}

export interface CreateStaffDto {
  /** Partner row data. */
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  isCompany?: boolean;

  /** StaffProfile data. */
  employeeNo: string;
  departmentId?: string;
  positionId?: string;
  campusId?: string;
  joinDate: Date | string;
  contractType?: 'permanent' | 'contract' | 'temporary' | 'probation';
  contractEndDate?: Date | string;
  compensation?: Record<string, unknown>;
  staffCategory?: 'teaching' | 'non_teaching' | 'admin' | 'support';
  customFields?: Record<string, unknown>;
}
export type UpdateStaffDto = Partial<CreateStaffDto> & {
  status?: 'active' | 'on_leave' | 'suspended' | 'terminated' | 'retired';
  reason?: string;
};

export interface CreatePositionDto {
  name: string;
  isTeaching?: boolean;
  defaultPermissions?: string[];
}
export type UpdatePositionDto = Partial<CreatePositionDto>;

export interface MarkStaffAttendanceDto {
  date: Date | string;
  entries: Array<{
    staffProfileId: string;
    status: 'present' | 'absent' | 'late' | 'leave' | 'off_duty';
    checkIn?: Date | string;
    checkOut?: Date | string;
    notes?: string;
  }>;
}