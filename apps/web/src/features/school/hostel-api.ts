import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Wave 16 — boarding: dormitories, rooms, beds and who sleeps where. */
const H = '/school/hostel';

export interface HostelBed {
  id: string;
  number: string;
  status: 'available' | 'occupied' | 'reserved' | 'maintenance' | string;
  allocation: { id: string; startDate: string; studentProfileId: string; name: string | null; admissionNo: string | null } | null;
}
export interface HostelRoom { id: string; number: string; type: string; beds: HostelBed[] }
export interface HostelDorm { id: string; name: string; gender: string; capacity: number; beds: number; occupied: number; rooms: HostelRoom[] }

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['school', 'hostel'] });

export function useHostelOccupancy() {
  return useQuery({ queryKey: ['school', 'hostel', 'occupancy'], queryFn: async () => (await api.get<HostelDorm[]>(`${H}/allocations/occupancy`)).data });
}
export function useCreateDormitory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { name: string; gender: string; capacity?: number }) => (await api.post(`${H}/dormitories`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { dormitoryId: string; number: string; type?: string; capacity?: number }) => (await api.post(`${H}/rooms`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useCreateBed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { roomId: string; number: string }) => (await api.post(`${H}/beds`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useSetBedStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (v: { id: string; status: string }) => (await api.patch(`${H}/beds/${v.id}`, { status: v.status })).data, onSuccess: () => invalidate(qc) });
}
export function useAllocateBed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (dto: { bedId: string; studentProfileId: string; startDate: string }) => (await api.post(`${H}/allocations/allocate`, dto)).data, onSuccess: () => invalidate(qc) });
}
export function useCheckoutBed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (v: { id: string; checkOutDate: string }) => (await api.post(`${H}/allocations/${v.id}/checkout`, { checkOutDate: v.checkOutDate })).data, onSuccess: () => invalidate(qc) });
}
