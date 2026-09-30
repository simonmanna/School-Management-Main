import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Sidebar sections an organization can switch on or off from Developer
 * Settings. Stored in `organization.settings.features` under `module.<key>`;
 * a key that was never saved falls back to `defaultOn`. The prefix keeps these
 * apart from the older free-form feature flags (`accounting`, `inventory`, …)
 * that some orgs already have saved as false.
 *
 * Presentation only: this hides menu entries, it does not disable the API.
 */
export interface SidebarModule {
  key: string;
  /** Must match the `title` of the section in app-shell NAV_SECTIONS. */
  section: string;
  description: string;
  defaultOn: boolean;
}

export const SIDEBAR_MODULES: SidebarModule[] = [
  { key: 'frontdesk', section: 'Frontdesk', description: 'Visitors, phone calls, complaints, CRM', defaultOn: true },
  { key: 'studentManagement', section: 'Student Management', description: 'Students, nursery day, categories, promotion, portals', defaultOn: true },
  { key: 'admissions', section: 'Admissions', description: 'Applications, review & enrol, placement', defaultOn: true },
  { key: 'academicManagement', section: 'Academic Management', description: 'Years, terms, classes, subjects, departments', defaultOn: true },
  { key: 'teachingAssessment', section: 'Teaching & Assessment', description: 'Assessments, gradebook, exams, results', defaultOn: true },
  { key: 'attendances', section: 'Attendances', description: 'Student registers and attendance reports', defaultOn: true },
  { key: 'timetable', section: 'Timetable & Calendar', description: 'Timetables, calendar, events, trips', defaultOn: true },
  { key: 'academics', section: 'Academics', description: 'Curriculum, lesson plans, learning outcomes', defaultOn: true },
  { key: 'transport', section: 'Transport Management', description: 'Vehicles, routes, stops, student assignments', defaultOn: true },
  { key: 'hrPayroll', section: 'Human Resource & Payroll', description: 'Employees, leave, payroll, recruitment', defaultOn: true },
  { key: 'documents', section: 'Document Management', description: 'School documents', defaultOn: true },
  { key: 'boarding', section: 'Boarding', description: 'Dormitories and bed allocation', defaultOn: true },
  { key: 'library', section: 'Library Management', description: 'Catalogue, copies, borrowings, fines', defaultOn: true },
  { key: 'schoolFinance', section: 'Fees & School Finance', description: 'Fees, billing, collections, receipts', defaultOn: true },
  { key: 'revenue', section: 'Revenue', description: 'Sales invoices, orders, credit notes, other income', defaultOn: true },
  { key: 'purchasing', section: 'Purchasing', description: 'Suppliers, purchases, goods receipts, debit notes', defaultOn: true },
  { key: 'expenses', section: 'Expenses', description: 'Expenses, categories, expense reports', defaultOn: true },
  { key: 'accounting', section: 'Accounting', description: 'Chart of accounts, journals, financial reports', defaultOn: true },
  { key: 'messaging', section: 'Messaging', description: 'Send messages and message history', defaultOn: true },
  { key: 'meals', section: 'Meals & Cafeteria', description: 'Meal plans, menus, kitchen, cafeteria POS', defaultOn: true },
  { key: 'inventory', section: 'Inventory', description: 'Stock levels, counts, transfers, products', defaultOn: true },
  { key: 'repairMaintenance', section: 'Repair & Maintenance', description: 'Repair orders, work orders, technicians', defaultOn: false },
  { key: 'fixedAssets', section: 'Fixed Assets', description: 'Asset register and categories', defaultOn: true },
  { key: 'taskManagement', section: 'Task Management', description: 'Kanban task board', defaultOn: false },
];

export const moduleFeatureKey = (key: string) => `module.${key}`;

const MODULE_BY_SECTION = new Map(SIDEBAR_MODULES.map((m) => [m.section, m]));

export function isModuleEnabled(features: Record<string, boolean> | undefined, mod: SidebarModule): boolean {
  const saved = features?.[moduleFeatureKey(mod.key)];
  return typeof saved === 'boolean' ? saved : mod.defaultOn;
}

/** Sections with no module entry (Dashboard, Settings) are always shown. */
export function isSectionEnabled(features: Record<string, boolean> | undefined, sectionTitle?: string): boolean {
  const mod = sectionTitle ? MODULE_BY_SECTION.get(sectionTitle) : undefined;
  return !mod || isModuleEnabled(features, mod);
}

export const ORG_FEATURES_QUERY_KEY = ['org-features'];

/**
 * Read from /organizations/me rather than /settings/developer: every signed-in
 * user can read the former, so the menu is trimmed for everyone, not only for
 * users holding setting:read.
 */
export function useOrgFeatures() {
  return useQuery<Record<string, boolean>>({
    queryKey: ORG_FEATURES_QUERY_KEY,
    queryFn: async () => {
      const org = (await api.get('/organizations/me')).data as { settings?: { features?: Record<string, boolean> } };
      return org?.settings?.features ?? {};
    },
    staleTime: 5 * 60 * 1000,
  });
}
