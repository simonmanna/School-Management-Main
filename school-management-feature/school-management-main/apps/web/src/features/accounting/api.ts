import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResult } from '@erp/shared';
import { api } from '@/lib/api';

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isGroup: boolean;
  isActive: boolean;
}

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () =>
      (await api.get<PaginatedResult<Account>>('/accounts', { params: { pageSize: 300 } })).data,
  });
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debit: string; credit: string };
  balanced: boolean;
}

export function useTrialBalance(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['trial-balance', params],
    queryFn: async () =>
      (await api.get<TrialBalance>('/reports/accounting/trial-balance', { params })).data,
  });
}

export interface JournalEntryRow {
  id: string;
  entryNumber: string;
  postingDate: string;
  description: string | null;
  status: string;
  journal: { code: string; name: string };
  _count?: { lines: number };
}

export interface JournalLine {
  id: string;
  description: string | null;
  debit: string;
  credit: string;
  account: { code: string; name: string };
}

export interface JournalEntryDetail extends JournalEntryRow {
  lines: JournalLine[];
}

export function useJournalEntries(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: ['journal-entries', params],
    queryFn: async () =>
      (await api.get<PaginatedResult<JournalEntryRow>>('/journal-entries', { params })).data,
  });
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['journal-entry', id],
    queryFn: async () => (await api.get<JournalEntryDetail>(`/journal-entries/${id}`)).data,
    enabled: !!id,
  });
}

export interface Journal {
  id: string;
  code: string;
  name: string;
  journalType: string;
  isActive: boolean;
}

export function useJournals() {
  return useQuery({
    queryKey: ['journals'],
    queryFn: async () =>
      (await api.get<PaginatedResult<Journal>>('/journals', { params: { pageSize: 100 } })).data,
  });
}

export interface ManualJournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  partnerId?: string;
  description?: string;
}

export interface CreateJournalEntryInput {
  journalCode: string;
  date: string;
  description?: string;
  lines: ManualJournalLineInput[];
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJournalEntryInput) =>
      (await api.post<JournalEntryDetail>('/journal-entries', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}

export function useReverseJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<JournalEntryDetail>(`/journal-entries/${id}/reverse`, {})).data,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      qc.invalidateQueries({ queryKey: ['journal-entry', id] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    },
  });
}
