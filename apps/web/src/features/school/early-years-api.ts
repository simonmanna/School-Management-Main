import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Early years (nursery): the daily care log, the pick-up list and the gate, the
 * incident log, and immunisation due dates.
 */
const CARE = '/school/care-logs';
const PICKUP = '/school/pickup';
const INCIDENTS = '/school/incidents';
const IMMUNISATION = '/school/immunisations';

export const CARE_MOODS = ['happy', 'settled', 'tired', 'tearful', 'unsettled', 'unwell'] as const;
export const MEAL_PORTIONS = ['all', 'most', 'some', 'none'] as const;
export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'other'] as const;
export const INCIDENT_KINDS = ['INJURY', 'ILLNESS', 'BEHAVIOUR', 'SAFEGUARDING', 'NEAR_MISS', 'OTHER'] as const;
export const INCIDENT_SEVERITIES = ['MINOR', 'MODERATE', 'SERIOUS'] as const;
export const NOTIFY_CHANNELS = ['in_person', 'phone', 'sms', 'whatsapp', 'portal'] as const;

export type CareMood = (typeof CARE_MOODS)[number];
export type MealPortion = (typeof MEAL_PORTIONS)[number];

export interface CareMeal { meal: string; portion: MealPortion; note?: string }
export interface CareNap { from: string; to?: string }

export interface CareLog {
  id: string;
  studentProfileId: string;
  onDate: string;
  arrivalMood: CareMood | null;
  departureMood: CareMood | null;
  meals: CareMeal[];
  naps: CareNap[];
  nappyChanges: number | null;
  usedToiletAlone: boolean | null;
  activities: string | null;
  teacherNote: string | null;
  sharedAt: string | null;
}

export interface CareDay {
  onDate: string;
  classId: string;
  sectionId: string | null;
  children: Array<{
    studentProfileId: string;
    name: string;
    admissionNo: string;
    sectionName: string | null;
    log: CareLog | null;
  }>;
}

export function useCareDay(classId?: string, onDate?: string, sectionId?: string) {
  return useQuery({
    queryKey: ['school', 'care-logs', classId, onDate, sectionId],
    enabled: !!classId && !!onDate,
    queryFn: async () =>
      (
        await api.get<CareDay>(`${CARE}/class/${classId}`, { params: { onDate, sectionId: sectionId || undefined } })
      ).data,
  });
}

export function useSaveCareLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<CareLog> & { studentProfileId: string; onDate: string }) =>
      (await api.post<CareLog>(CARE, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'care-logs'] }),
  });
}

export function useShareCareLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, shared }: { id: string; shared: boolean }) =>
      (await api.post<CareLog>(`${CARE}/${id}/${shared ? 'share' : 'unshare'}`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'care-logs'] }),
  });
}

export interface WhoMayCollect {
  at: string;
  guardians: Array<{ studentGuardianId: string; contactId: string; name: string; phone: string | null; relationship: string; source: 'guardian' }>;
  authorizations: Array<{
    authorizationId: string;
    kind: 'STANDING' | 'ONE_OFF';
    name: string;
    phone: string | null;
    relationship: string | null;
    idType: string | null;
    idNumber: string | null;
    validTo: string | null;
    source: 'authorization';
  }>;
}

export function useWhoMayCollect(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'pickup', 'who', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<WhoMayCollect>(`${PICKUP}/who-may-collect/${studentProfileId}`)).data,
  });
}

export function useCreatePickupAuthorization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      studentProfileId: string;
      kind?: 'STANDING' | 'ONE_OFF';
      contactId?: string;
      personName?: string;
      personPhone?: string;
      relationship?: string;
      idType?: string;
      idNumber?: string;
      validFrom?: string;
      validTo?: string;
      notes?: string;
    }) => (await api.post(`${PICKUP}/authorizations`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'pickup'] }),
  });
}

export function useRevokePickupAuthorization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await api.patch(`${PICKUP}/authorizations/${id}/revoke`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'pickup'] }),
  });
}

export function useReleaseChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      studentProfileId: string;
      authorizationId?: string;
      collectedByName?: string;
      overrideReason?: string;
      notes?: string;
    }) => (await api.post(`${PICKUP}/release`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'pickup'] }),
  });
}

export interface PickupRelease {
  id: string;
  studentProfileId: string;
  collectedByName: string;
  collectedAt: string;
  overrideReason: string | null;
  studentProfile?: { partner?: { name?: string } | null; admissionNo?: string } | null;
}

export function usePickupReleases(onDate?: string) {
  return useQuery({
    queryKey: ['school', 'pickup', 'releases', onDate],
    enabled: !!onDate,
    queryFn: async () => (await api.get<PickupRelease[]>(`${PICKUP}/releases`, { params: { onDate } })).data,
  });
}

export interface ChildIncident {
  id: string;
  studentProfileId: string;
  kind: (typeof INCIDENT_KINDS)[number];
  severity: (typeof INCIDENT_SEVERITIES)[number];
  occurredAt: string;
  location: string | null;
  description: string;
  actionTaken: string | null;
  bodyPart: string | null;
  guardianNotifiedAt: string | null;
  guardianNotifiedHow: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  studentName?: string | null;
  needs?: string[];
}

export function useOutstandingIncidents() {
  return useQuery({
    queryKey: ['school', 'incidents', 'outstanding'],
    queryFn: async () => (await api.get<ChildIncident[]>(`${INCIDENTS}/outstanding`)).data,
  });
}

export function useStudentIncidents(studentProfileId?: string) {
  return useQuery({
    queryKey: ['school', 'incidents', studentProfileId],
    enabled: !!studentProfileId,
    queryFn: async () => (await api.get<ChildIncident[]>(`${INCIDENTS}/by-student/${studentProfileId}`)).data,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      studentProfileId: string;
      kind: string;
      severity?: string;
      occurredAt: string;
      location?: string;
      description: string;
      actionTaken?: string;
      bodyPart?: string;
    }) => (await api.post(INCIDENTS, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'incidents'] }),
  });
}

export function useNotifyIncidentGuardian() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, how }: { id: string; how: string }) =>
      (await api.patch(`${INCIDENTS}/${id}/notified`, { how })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'incidents'] }),
  });
}

export function useReviewIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reviewNotes }: { id: string; reviewNotes?: string }) =>
      (await api.patch(`${INCIDENTS}/${id}/review`, { reviewNotes })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'incidents'] }),
  });
}

export interface ImmunisationDue {
  classId: string;
  withinDays: number;
  due: Array<{
    id: string;
    studentProfileId: string;
    studentName: string | null;
    vaccine: string;
    doseLabel: string | null;
    nextDueOn: string | null;
    overdue: boolean;
  }>;
  noRecord: Array<{ studentProfileId: string; studentName: string | null; admissionNo: string }>;
}

export function useImmunisationDue(classId?: string, withinDays = 30) {
  return useQuery({
    queryKey: ['school', 'immunisations', 'due', classId, withinDays],
    enabled: !!classId,
    queryFn: async () =>
      (await api.get<ImmunisationDue>(`${IMMUNISATION}/due/${classId}`, { params: { withinDays } })).data,
  });
}

export function useSaveImmunisation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      studentProfileId: string;
      vaccine: string;
      doseLabel?: string;
      administeredOn?: string;
      nextDueOn?: string;
      exemptionReason?: string;
      notes?: string;
    }) => (await api.post(IMMUNISATION, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school', 'immunisations'] }),
  });
}
