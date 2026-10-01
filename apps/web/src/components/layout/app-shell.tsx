import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeaderComms } from './header-comms';
import {
  LayoutDashboard,
  FileUp,
  Building2,
  Users,
  Package,
  Receipt,
  FileMinus,
  HandCoins,
  FileText,
  Banknote,
  Clock,
  Scale,
  Settings as SettingsIcon,
  Settings2,
  LogOut,
  Menu,
  ShoppingCart,
  Truck,
  FilePlus2,
  Tag,
  AlertTriangle,
  Ticket,
  BadgeDollarSign,
  Baby,
  BarChart3,
  FileBarChart,
  UserCog,
  Shield,
  ShieldCheck,
  ClipboardList,
  ClipboardCheck,
  ChefHat,
  CreditCard,
  UtensilsCrossed,
  PanelLeftClose,
  PanelLeft,
  BookOpen,
  BedDouble,
  GraduationCap,
  BookText,
  Bus,
  ScrollText,
  HelpCircle,
  Smartphone,
  MapPin,
  School,
  SlidersHorizontal,
  Layers,
  Link2,
  CalendarX2,
  Landmark,
  Ruler,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  History,
  CalendarDays,
  CalendarRange,
  CalendarHeart,
  Briefcase,
  FileClock,
  Wallet,
  Percent,
  Lock,
  Handshake,
  Wrench,
  Timer,
  Calculator,
  CalendarClock,
  ChevronDown,
  FileQuestion,
  FileBadge,
  FileSignature,
  UserPlus,
  Award,
  Eye,
  PiggyBank,
  UserCircle,
  DoorOpen,
  Phone,
  Presentation,
  BookCopy,
  FileStack,
  CalendarCheck,
  MessagesSquare,
  Target,
  GitBranch,
  Copy,
  ArrowLeftRight,
  Workflow,
  Coins,
  FileSpreadsheet,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth.store';
import { serverLogout } from '@/lib/server-logout';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { GlobalSearch } from '@/components/global-search';
import { PushBootstrap } from '@/components/push-bootstrap';
import { RouteErrorBoundary } from '@/components/error-boundary';
import { ThemePicker } from '@/components/theme-picker';
import { useTranslation } from 'react-i18next';
import { useSidebarTheme } from '@/lib/sidebar-theme';
import { enhanceTablesIn } from '@/lib/table-enhancer';
import { isSectionEnabled, useOrgFeatures } from '@/lib/sidebar-modules';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

function BranchSwitcher() {
  const { currentBranchId, setCurrentBranch } = useAuthStore();
  const { data } = useQuery<{ data: BranchOption[] }>({
    queryKey: ['branches-switch'],
    queryFn: async () => (await api.get('/branches', { params: { pageSize: 200 } })).data,
  });

  const branches = data?.data ?? [];

  const onSelect = async (value: string) => {
    const id = value === '__all__' ? null : value;
    setCurrentBranch(id); // optimistic local state
    try {
      await api.patch('/organizations/me/branch', { defaultBranchId: id });
    } catch {
      notify.error('Failed to switch branch');
    }
  };

  return (
    <Select value={currentBranchId ?? '__all__'} onValueChange={onSelect}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select branch" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All branches</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Required grant. An array means ANY of them (an org-wide or an own-scoped grant). */
  permission?: string | readonly string[];
  badge?: string;
  /** Optional sub-grouping label rendered as a sub-header above the item (expanded mode only). */
  group?: string;
  /** Per-item feature gate, resolved the same way as section flags. */
  flag?: 'VITE_ENABLE_BEVERAGE' | 'VITE_ENABLE_ASSETS' | 'VITE_ENABLE_TASKS' | 'VITE_ENABLE_MANUFACTURING' | 'VITE_ENABLE_RENTAL' | 'VITE_ENABLE_REPAIR' | 'VITE_ENABLE_HR' | 'VITE_ENABLE_ORDERS' | 'VITE_ENABLE_COMMUNICATION' | 'VITE_ENABLE_SCHOOL' | 'VITE_ENABLE_ADVANCED_LMS' | 'VITE_ENABLE_LIVE_MOBILE_MONEY';
}

interface NavSection {
  title?: string;
  icon?: typeof LayoutDashboard;
  items: NavItem[];
  /**
   * Opt-in section, mirroring the API's ENABLE_* module gates. This is the
   * second layer only — the API decides what actually runs. Hiding a section
   * here without gating the module server-side would leave its routes, crons
   * and boot hooks live.
   */
  flag?: 'VITE_ENABLE_BEVERAGE' | 'VITE_ENABLE_ASSETS' | 'VITE_ENABLE_TASKS' | 'VITE_ENABLE_MANUFACTURING' | 'VITE_ENABLE_RENTAL' | 'VITE_ENABLE_REPAIR' | 'VITE_ENABLE_HR' | 'VITE_ENABLE_ORDERS' | 'VITE_ENABLE_COMMUNICATION' | 'VITE_ENABLE_SCHOOL' | 'VITE_ENABLE_ADVANCED_LMS' | 'VITE_ENABLE_LIVE_MOBILE_MONEY';
}

const flagEnabled = (flag?: string): boolean =>
  !flag || (import.meta.env as Record<string, string | undefined>)[flag] === 'true';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Frontdesk',
    icon: Users,
    items: [
      { to: '/school/front-desk', label: 'Visitors', icon: DoorOpen, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/phone-calls', label: 'Phone Calls', icon: Phone, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/complaints', label: 'Complaints', icon: AlertTriangle, permission: PERMISSIONS.school.manageFoundation },
      // "Applications" used to appear here AND under Admissions, so the starting
      // point of the school's single most important workflow was ambiguous.
      // Admissions owns it; the front desk reaches it from there.
      { to: '/crm', label: 'CRM Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.crm.dashboardRead },
      { to: '/crm/deals', label: 'Deals', icon: Handshake, permission: PERMISSIONS.crm.dealRead },
    ],
  },
  {
    title: 'Student Management',
    icon: GraduationCap,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/students', label: 'Students', icon: GraduationCap, permission: PERMISSIONS.school.read },
      { to: '/school/students/import', label: 'Import Students', icon: FileUp, permission: PERMISSIONS.school.manageStudents },
      // Nursery. One screen for the four things a nursery does that a primary
      // school does not: account for the day, control who collects a child,
      // write down what happened, and chase immunisation.
      { to: '/school/early-years', label: 'Nursery Day', icon: Baby, permission: PERMISSIONS.school.read },
      { to: '/school/management/student-categories', label: 'Student Categories', icon: Tag, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/promotion', label: 'Promote & Roll Over', icon: TrendingUp, permission: PERMISSIONS.school.manageStudents },
      { to: '/school/portals', label: 'Parent & Pupil Portals', icon: GraduationCap, permission: PERMISSIONS.school.read },
      { to: '/school/analytics', label: 'Analytics', icon: BarChart3, permission: PERMISSIONS.school.read },
    ],
  },
  {
    title: 'Admissions',
    icon: FilePlus2,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      // The journey in the order a school walks it: applications arrive,
      // somebody decides, the applicant is enrolled and seated. Configuration
      // and analytics sit below it rather than beside it.
      { to: '/school/applications', label: 'Applications', icon: FileText, permission: PERMISSIONS.school.manageAdmissions },
      { to: '/school/admissions', label: 'Review & Enrol', icon: FilePlus2, permission: PERMISSIONS.school.readAdmissions },
      // Phase 1 canonical enrollment spine (ADR-018 / ADR-019). Separate from the
      // admissions funnel above: admissions decides who joins, this decides where
      // they sit and keeps the history of every move.
      { to: '/school/enrollment', label: 'Enrollment & Placement', icon: Users, permission: PERMISSIONS.school.read },
      { to: '/school/enrollment/programmes', label: 'Programmes & Classes', icon: Layers, permission: PERMISSIONS.school.manageProgrammes, group: 'Setup' },
      { to: '/school/admissions/config', label: 'Admissions Config', icon: FileText, permission: PERMISSIONS.school.manageAdmissions, group: 'Setup' },
      { to: '/school/admissions/workflow', label: 'Admission Workflow', icon: Workflow, permission: PERMISSIONS.school.manageAdmissions, group: 'Setup' },
      { to: '/school/admissions/analytics', label: 'Admissions Analytics', icon: BarChart3, permission: PERMISSIONS.school.read, group: 'Reports' },
      { to: '/school/admissions/enrollment-summary', label: 'Enrollment Summary', icon: BarChart3, group: 'Reports' },
    ],
  },
  {
    title: 'Academic Management',
    icon: BookOpen,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      // Foundation / organisation structure — order per product spec.
      { to: '/school/management/academic-years', label: 'Academic Years', icon: CalendarRange, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/terms', label: 'Terms / Semesters', icon: CalendarClock, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/classes', label: 'Classes / Grades', icon: Layers, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/grades', label: 'Grade Ladder & Levels', icon: Layers, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/sections', label: 'Streams / Sections', icon: Layers, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/departments', label: 'Departments', icon: Building2, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/settings', label: 'School Settings', icon: SettingsIcon, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/campuses', label: 'Campuses', icon: Building2, permission: PERMISSIONS.school.read },
      // Remaining academic-management tools.
      //
      // One Subjects destination. `/school/subjects` is a read-only overview of
      // subjects, periods and the calendar, which repeated Academic Years, Terms
      // and Subjects right above it; the route still works and is linked from the
      // subjects screen, but it is no longer a competing menu entry.
      { to: '/school/management/subjects', label: 'Subjects', icon: BookOpen, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/class-teacher', label: 'Class Teachers', icon: Users, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/course-offerings', label: 'Teaching Allocation', icon: Users, permission: PERMISSIONS.school.manageCourses },
      { to: '/school/teacher-cover', label: 'Teacher Cover', icon: CalendarX2, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/management/roles', label: 'Roles & Permissions', icon: ShieldCheck, permission: PERMISSIONS.role.read },
    ],
  },
  {
    // Assessments leads, because that is what a teacher came here to do. Kind
    // (CAT, homework, project, practical, exam) is a filter inside it, not a
    // separate menu item — the four numbered exam steps and "Homework & Tasks"
    // used to be siblings of the gradebook, which forced a teacher to decide
    // which subsystem they were in before they could mark anybody.
    title: 'Teaching & Assessment',
    icon: BookText,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/teaching', label: 'My Teaching', icon: ClipboardCheck, permission: PERMISSIONS.school.read },
      { to: '/school/assessments', label: 'Assessments', icon: ClipboardList, permission: PERMISSIONS.school.read },
      { to: '/school/gradebook', label: 'Gradebook', icon: BookText, permission: PERMISSIONS.school.enterGrades },
      { to: '/school/approvals', label: 'Approvals', icon: ShieldCheck, permission: PERMISSIONS.school.approveGrades },

      { to: '/school/cbt', label: 'CBT / Quizzes', icon: FileQuestion, permission: PERMISSIONS.school.authorCbt, group: 'Tools' },

      { to: '/school/assessment', label: 'Assessment Structure', icon: Target, permission: PERMISSIONS.school.manageAssessments, group: 'Setup' },
      { to: '/school/grading-scales', label: 'Grading Scales', icon: Calculator, permission: PERMISSIONS.school.manageAssessments, group: 'Setup' },
      { to: '/school/assessment-ops', label: 'Cohorts & Rubrics', icon: ClipboardList, permission: PERMISSIONS.school.manageAssessments, group: 'Setup' },

      // Examinations keeps its own cockpit — scheduling papers across classes,
      // venues and seating are real exams-office work. It is no longer where
      // marking begins, which is why it sits below Assessments rather than
      // above it as a numbered wizard.
      // Marking has ONE owner in the sidebar: the Gradebook above. Exam mark
      // entry is the same job reached from a scheduled paper, so it is linked
      // from Exam Scheduling rather than presented as a rival destination.
      { to: '/school/exam-workspace', label: 'Exam Scheduling', icon: CalendarDays, permission: PERMISSIONS.school.manageExams, group: 'Examinations' },
      { to: '/school/exam-operations', label: 'Run an Examination', icon: ShieldCheck, permission: PERMISSIONS.school.runExamOperations, group: 'Examinations' },
      { to: '/school/exam-ops', label: 'Venues, Seating & Papers', icon: MapPin, permission: PERMISSIONS.school.manageExams, group: 'Examinations' },
      // Phase 6 — what the school sends to UNEB, and whether it can yet.
      { to: '/school/statutory', label: 'National Submissions', icon: FileSpreadsheet, permission: PERMISSIONS.school.readStatutory, group: 'Examinations' },

      // Release has ONE owner. "Report Cards" and "Results & Reports" both looked
      // like the place a term is published from, and only one of them goes through
      // the immutable ResultSet the portal is served from. Computing and publishing
      // leads; the documents that fall out of it follow.
      { to: '/school/results', label: 'Compute & Publish Results', icon: GitBranch, permission: PERMISSIONS.school.computeResults, group: 'Results' },
      { to: '/school/report-cards', label: 'Report Documents', icon: FileText, permission: PERMISSIONS.school.manageExams, group: 'Results' },
      { to: '/school/exam-results', label: 'Exam Results', icon: BarChart3, permission: PERMISSIONS.school.read, group: 'Results' },
      { to: '/school/competency-report', label: 'Competency & Annual', icon: GraduationCap, permission: PERMISSIONS.school.read, group: 'Results' },
      { to: '/school/certification', label: 'Certification', icon: FileBadge, permission: PERMISSIONS.school.read, group: 'Results' },
      { to: '/school/reports', label: 'Report Centre', icon: BarChart3, permission: PERMISSIONS.school.readReports, group: 'Results' },
      { to: '/school/report-card-settings', label: 'Report Card Design', icon: SlidersHorizontal, permission: PERMISSIONS.school.manageExams, group: 'Results' },
    ],
  },
  {
    title: 'Attendances',
    icon: ClipboardCheck,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      // Org-wide OR own-class: a class teacher takes their own register here too;
      // the API scopes which classes (audit R07 acceptance, wave 17).
      { to: '/school/attendance', label: 'Attendance', icon: ClipboardCheck, permission: [PERMISSIONS.school.takeAttendance, PERMISSIONS.school.ownAttendance] },
      { to: '/school/attendance/report', label: 'Attendance Report', icon: BarChart3, permission: PERMISSIONS.school.read },
      { to: '/school/attendance/statuses', label: 'Statuses', icon: Settings2 },
    ],
  },
  {
    title: 'Timetable & Calendar',
    icon: CalendarClock,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/timetable', label: 'Timetable', icon: CalendarClock, permission: PERMISSIONS.school.read },
      { to: '/school/timetable/class', label: 'Class Timetable', icon: CalendarClock, permission: PERMISSIONS.school.read },
      { to: '/school/timetable/student', label: 'Student Timetable', icon: CalendarClock, permission: PERMISSIONS.school.read },
      { to: '/school/timetable/calendar', label: 'Calendar', icon: CalendarDays, permission: PERMISSIONS.school.read },
      { to: '/school/timetable/events', label: 'Events', icon: CalendarHeart, permission: PERMISSIONS.school.read },
      { to: '/school/timetable/trips', label: 'Trips & Field Activities', icon: MapPin, group: 'Activities & Extracurriculars', permission: PERMISSIONS.school.read },
    ],
  },
  {
    // Curriculum & Lessons — the teaching half of the old LMS section, now that
    // homework and the teacher dashboard have moved into Teaching & Assessment.
    // Every item carries a permission guard (they previously had none).
    title: 'Academics',
    icon: Presentation,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/course-offerings', label: 'Curriculum & Courses', icon: BookCopy, permission: PERMISSIONS.school.manageCourses, group: 'Courses' },
      { to: '/school/lms/lesson-plans', label: 'Lesson Plans', icon: Presentation, permission: PERMISSIONS.school.manageLessonPlans, group: 'Planning' },
      { to: '/school/lms/templates', label: 'Plan Templates', icon: FileStack, permission: PERMISSIONS.school.manageLessonPlans, group: 'Planning' },
      { to: '/school/lms/scheduled-lessons', label: 'Scheduled Lessons', icon: CalendarCheck, permission: PERMISSIONS.school.lmsRead, group: 'Planning' },
      { to: '/school/learning-outcomes', label: 'Learning Outcomes', icon: Award, permission: PERMISSIONS.school.read, group: 'Outcomes' },
      { to: '/school/lms/courses', label: 'Advanced Courses', icon: GraduationCap, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/coverage', label: 'Curriculum Coverage', icon: GitBranch, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/mastery', label: 'Mastery & Evidence', icon: Target, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/discussions', label: 'Discussions', icon: MessagesSquare, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/badges', label: 'Badges', icon: Award, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/calendar', label: 'LMS Calendar', icon: CalendarCheck, permission: PERMISSIONS.school.lmsRead, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
      { to: '/school/lms/admin', label: 'LMS Admin', icon: Settings2, permission: PERMISSIONS.school.manageCourses, group: 'Advanced LMS', flag: 'VITE_ENABLE_ADVANCED_LMS' },
    ],
  },
  {
    title: 'Transport Management',
    icon: Bus,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/transport', label: 'Transport Management', icon: Bus, permission: PERMISSIONS.school.transportRead },
      { to: '/school/transport?tab=vehicles', label: 'Vehicles', icon: Bus, permission: PERMISSIONS.school.manageFleet },
      { to: '/school/transport?tab=routes', label: 'Routes', icon: MapPin, permission: PERMISSIONS.school.manageTransport },
      { to: '/school/transport?tab=stops', label: 'Stops', icon: MapPin, permission: PERMISSIONS.school.manageTransport },
      { to: '/school/transport?tab=students', label: 'Student Assignments', icon: Users, permission: PERMISSIONS.school.transportEnrollment },
    ],
  },
  {
    title: 'Human Resource & Payroll',
    icon: Users,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/staff', label: 'Teaching Staff (roster)', icon: Users, permission: PERMISSIONS.school.read },
      { to: '/hr', label: 'Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.hr.read },
      { to: '/hr/employees', label: 'Employees', icon: Users, permission: PERMISSIONS.hr.employee },
      { to: '/hr/departments', label: 'Departments', icon: Building2, permission: PERMISSIONS.hr.employee },
      { to: '/hr/positions', label: 'Positions', icon: Briefcase, permission: PERMISSIONS.hr.employee },
      { to: '/hr/shifts', label: 'Shifts', icon: Clock, permission: PERMISSIONS.hr.attendance },
      { to: '/hr/attendance', label: 'Attendance', icon: ClipboardCheck, permission: PERMISSIONS.hr.attendance },
      { to: '/hr/timesheets', label: 'Timesheets', icon: FileClock, permission: PERMISSIONS.hr.timesheet },
      { to: '/hr/leave', label: 'Leave', icon: CalendarDays, permission: PERMISSIONS.hr.leave },
      { to: '/hr/holidays', label: 'Holidays', icon: CalendarHeart, permission: PERMISSIONS.hr.holiday },
      { to: '/hr/payroll', label: 'Payroll', icon: Wallet, permission: PERMISSIONS.hr.payroll },
      { to: '/hr/payslips', label: 'Payslips', icon: FileText, permission: PERMISSIONS.hr.payslip },
      { to: '/hr/payroll/inputs', label: 'Payroll Inputs', icon: Coins, permission: PERMISSIONS.hr.payrollInput },
      { to: '/hr/advances-loans', label: 'Advances & Loans', icon: HandCoins, permission: PERMISSIONS.hr.payroll },
      { to: '/hr/payroll/settings', label: 'Payroll Settings', icon: SettingsIcon, permission: PERMISSIONS.hr.payroll },
      { to: '/hr/reports', label: 'Reports', icon: BarChart3, permission: PERMISSIONS.hr.readReports },
      { to: '/hr/job-grades', label: 'Job Grades & Salary Structures', icon: GraduationCap, permission: PERMISSIONS.hr.grade },
      { to: '/hr/contracts', label: 'Contracts', icon: FileSignature, permission: PERMISSIONS.hr.contract },
      { to: '/hr/recruitment', label: 'Recruitment', icon: UserPlus, permission: PERMISSIONS.hr.recruitment },
      { to: '/hr/qualifications', label: 'Qualifications & Certifications', icon: Award, permission: PERMISSIONS.hr.qualification },
      { to: '/hr/training', label: 'Training & CPD', icon: BookOpen, permission: PERMISSIONS.hr.training },
      { to: '/hr/offboarding', label: 'Offboarding & Settlement', icon: LogOut, permission: PERMISSIONS.hr.offboarding },
      { to: '/hr/reconciliation', label: 'Record Reconciliation', icon: Link2, permission: PERMISSIONS.hr.employeeIdentity },
      { to: '/hr/payroll/preview', label: 'Payroll Preview', icon: Eye, permission: PERMISSIONS.hr.payroll },
      { to: '/hr/my', label: 'My HR', icon: UserCircle, permission: PERMISSIONS.hr.read },
    ],
  },
  {
    title: 'Document Management',
    icon: FileText,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/documents', label: 'Documents', icon: FileText, permission: PERMISSIONS.school.read },
    ],
  },
  {
    title: 'Boarding',
    icon: BedDouble,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/hostel', label: 'Dormitories & beds', icon: BedDouble, permission: PERMISSIONS.school.read },
    ],
  },
  {
    title: 'Library Management',
    icon: BookOpen,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/library', label: 'Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/catalogue', label: 'Catalogue', icon: BookOpen, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/copies', label: 'Copies', icon: Copy, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/borrowings', label: 'Borrowings', icon: ArrowLeftRight, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/students', label: 'Students', icon: Users, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/fines', label: 'Fines', icon: AlertTriangle, permission: PERMISSIONS.school.manageLibrary },
      { to: '/school/library/reports', label: 'Reports', icon: BarChart3, permission: PERMISSIONS.school.manageLibrary },
    ],
  },
  // ===== Finance & Accounting =====
  {
    title: 'Fees & School Finance',
    icon: Receipt,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      // Approvers (Head Teacher) reach the refund and correction queues here too;
      // the page's actions are still gated by the API (wave 17 acceptance).
      { to: '/school/fees', label: 'Fees & Billing', icon: Receipt, permission: [PERMISSIONS.school.manageFees, PERMISSIONS.school.approveRefunds, PERMISSIONS.school.approveCredits] },
      { to: '/school/fees/categories', label: 'Fee Categories', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/structures', label: 'Fee Structures', icon: Layers, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/optional', label: 'Optional Fees', icon: Ticket, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/schedules', label: 'Fee Schedules', icon: CalendarClock, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/dashboard', label: 'Finance Dashboard', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/invoices', label: 'Fee Invoices', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/ledger', label: 'Student Ledger', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/billing-runs', label: 'Billing Runs', icon: Receipt, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/adjustments', label: 'Adjustments', icon: Receipt, permission: [PERMISSIONS.school.manageFees, PERMISSIONS.school.approveAdjustments] },
      { to: '/school/fees/reconciliation', label: 'Payment Reconciliation', icon: HandCoins, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/term-close', label: 'Term Close', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/collect', label: 'Record Fee Payments', icon: HandCoins, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/bulk-collect', label: 'Bulk Collection', icon: HandCoins, permission: PERMISSIONS.school.collectPayments },
      { to: '/school/fees/receipts', label: 'Receipts & Reprints', icon: Receipt, permission: PERMISSIONS.school.readFees },
      // ADR-032 P6 / audit F13: live collection is off until the provider contract is accepted.
      { to: '/school/fees/mobile-money', label: 'Mobile Money', icon: Smartphone, permission: PERMISSIONS.school.collectPayments, flag: 'VITE_ENABLE_LIVE_MOBILE_MONEY' },
      { to: '/school/fees/explain', label: 'Explain a Balance', icon: HelpCircle, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/clearance', label: 'Fee Clearance', icon: ShieldCheck, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/statement', label: 'Fee Statement', icon: FileText, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/cash-book', label: 'Daily Cash Book', icon: Banknote, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/discounts', label: 'Discounts', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/overrides', label: 'Fee Overrides', icon: Ticket, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/waiver-categories', label: 'Waiver Categories', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/waivers', label: 'Fee Waivers', icon: Ticket, permission: [PERMISSIONS.school.manageFees, PERMISSIONS.school.approveWaivers] },
      { to: '/school/fees/defaulters', label: 'Fee Defaulters', icon: AlertTriangle, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/bad-debtors', label: 'Bad Debtors', icon: BadgeDollarSign, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/budgeting', label: 'Budgeting', icon: PiggyBank, permission: PERMISSIONS.school.manageFees },
      // Gated like their twins in Revenue/Accounting: ungated, every staff
      // preset saw finance entries that only 403'd on click (E2E audit S5).
      { to: '/pos/cash-registers', label: 'Cash Register', icon: Banknote, permission: PERMISSIONS.cashSession.read },
      { to: '/payments', label: 'Receipts', icon: HandCoins, permission: PERMISSIONS.payment.read },
      { to: '/ar-aging', label: 'Accounts Receivable', icon: Clock, permission: PERMISSIONS.report.ar },
      { to: '/supplier-payments', label: 'Supplier Payments', icon: Banknote, permission: PERMISSIONS.payment.read },
      { to: '/accounts/cash-accounts', label: 'Accounts', icon: Wallet, permission: PERMISSIONS.account.read },
    ],
  },
  {
    title: 'Revenue',
    icon: ShoppingCart,
    items: [
      { to: '/invoices', label: 'Sales/Invoices', icon: Receipt, permission: PERMISSIONS.invoice.read },
      { to: '/orders', label: 'Orders', icon: ClipboardList },
      { to: '/credit-notes', label: 'Credit Notes', icon: FileMinus, permission: PERMISSIONS.creditNote.read },
      { to: '/payments', label: 'Receipts', icon: HandCoins, permission: PERMISSIONS.payment.read },
      { to: '/ar-aging', label: 'Accounts Receivable', icon: Clock, permission: PERMISSIONS.report.ar },
      { to: '/income', label: 'Other Income', icon: Coins, permission: PERMISSIONS.income.read },
    ],
  },
  {
    title: 'Purchasing',
    icon: Truck,
    items: [
      { to: '/suppliers', label: 'Suppliers', icon: Building2 },
      { to: '/procurement/purchase-orders', label: 'Purchases', icon: ShoppingCart, permission: 'purchase_order:read' },
      { to: '/procurement/goods-receipts', label: 'Goods Receipts', icon: Truck, permission: 'goods_receipt:read' },
      // { to: '/procurement/three-way-match', label: '3-Way Match', icon: Scale, permission: 'three_way_match:read' },
      { to: '/procurement/debit-notes', label: 'Debit Notes', icon: FilePlus2, permission: 'debit_note:read' },
      { to: '/supplier-payments', label: 'Supplier Payments', icon: Banknote, permission: 'payment:read' },
    ],
  },
  {
    title: 'Expenses',
    icon: FileText,
    items: [
      { to: '/expenses', label: 'Expenses', icon: FileText, permission: PERMISSIONS.expense.read },
      { to: '/expenses/categories', label: 'Expense Categories', icon: Tag, permission: PERMISSIONS.expense.read },
      { to: '/expenses/reports', label: 'Expense Reports', icon: BarChart3, permission: PERMISSIONS.expense.read },
      { to: '/supplier-payments', label: 'Supplier Payments', icon: Banknote, permission: PERMISSIONS.payment.read },
    ],
  },
  {
    title: 'Accounting',
    icon: Calculator,
    items: [
      { to: '/accounts/cash-accounts', label: 'Financial Accounts', icon: Banknote, permission: PERMISSIONS.account.read },
      { to: '/bank-reconciliation', label: 'Bank Reconciliation', icon: Scale, permission: PERMISSIONS.bankReconciliation.read },
      { to: '/accounts', label: 'Chart of Accounts', icon: BookOpen, permission: PERMISSIONS.account.read },
      { to: '/accounts/categories', label: 'Account Categories', icon: Layers, permission: PERMISSIONS.accountCategory.read },
      { to: '/accounts/cash-registers', label: 'Cash Registers', icon: Smartphone, permission: 'cash_register:read' },
      { to: '/accounts/mappings', label: 'Account Mappings', icon: Link2, permission: PERMISSIONS.accountMapping.read },
      { to: '/accounts/posting-rules', label: 'Posting Rules', icon: FileText, permission: PERMISSIONS.inventoryPostingRule.read },
      { to: '/journals', label: 'Journals', icon: BookText, permission: PERMISSIONS.journal.read },
      { to: '/journal-entries', label: 'Journal Entries', icon: ScrollText, permission: PERMISSIONS.journalEntry.read },
      { to: '/accounting/reports', label: 'Reports', icon: FileBarChart, permission: PERMISSIONS.report.accounting },
      { to: '/trial-balance', label: 'Trial Balance', icon: Scale, permission: PERMISSIONS.report.accounting },
      { to: '/general-ledger', label: 'General Ledger', icon: ArrowUpDown, permission: PERMISSIONS.report.accounting },
      { to: '/profit-and-loss', label: 'Profit & Loss', icon: TrendingUp, permission: PERMISSIONS.report.accounting },
      { to: '/cash-flow', label: 'Cash Flow', icon: TrendingDown, permission: PERMISSIONS.report.accounting },
      { to: '/tieout', label: 'Tie-Out', icon: ShieldCheck, permission: PERMISSIONS.report.accounting },
      { to: '/audit-log', label: 'Audit Log', icon: History, permission: PERMISSIONS.auditLog.read },
      { to: '/fiscal-periods', label: 'Fiscal Periods', icon: CalendarDays, permission: PERMISSIONS.fiscalPeriod.read },
      { to: '/taxes', label: 'Tax Rates', icon: Percent, permission: PERMISSIONS.tax.read },
      { to: '/cost-centers', label: 'Cost Centers', icon: Users, permission: PERMISSIONS.costCenter.read },
      { to: '/currency', label: 'Currency', icon: Banknote, permission: PERMISSIONS.currency.read },
      { to: '/accounts/payment-terms', label: 'Payment Terms', icon: CalendarClock, permission: PERMISSIONS.account.read },
      { to: '/accounts/fiscal-positions', label: 'Fiscal Positions', icon: Landmark, permission: PERMISSIONS.account.read },
      { to: '/inventory-valuation', label: 'Inventory Val.', icon: Package, permission: PERMISSIONS.report.accounting },
      { to: '/year-end-close', label: 'Year-End Close', icon: Lock, permission: PERMISSIONS.fiscalPeriod.update },
      { to: '/balance-sheet', label: 'Balance Sheet', icon: Landmark, permission: PERMISSIONS.report.accounting },
      { to: '/reports', label: 'Report Center', icon: BarChart3, permission: PERMISSIONS.report.accounting },
    ],
  },
  {
    title: 'Messaging',
    icon: MessagesSquare,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/messaging', label: 'Send Message', icon: MessagesSquare, permission: PERMISSIONS.school.read },
      { to: '/school/messaging?tab=history', label: 'Message History', icon: History, permission: PERMISSIONS.school.read },
    ],
  },
  // ===== Meals & Cafeteria =====
  {
    title: 'Meals & Cafeteria',
    icon: UtensilsCrossed,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/meals?tab=today', label: 'Today’s Meals', icon: CalendarDays, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=planning', label: 'Programs & Plans', icon: ClipboardList, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=assignments', label: 'Student Assignments', icon: Users, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=attendance', label: 'Meal Attendance', icon: ClipboardCheck, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=menus', label: 'Menus', icon: UtensilsCrossed, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=kitchen', label: 'Kitchen & Production', icon: ChefHat, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=consumption', label: 'Consumption', icon: BarChart3, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=finance', label: 'Meal Finance', icon: HandCoins, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=pos', label: 'Cafeteria POS', icon: CreditCard, permission: PERMISSIONS.school.read },
      { to: '/school/meals?tab=reports', label: 'Reports', icon: BarChart3, permission: PERMISSIONS.school.read },
    ],
  },
  // ===== Supplementary / Assets / Equipment / Settings =====
  {
    title: 'Inventory',
    icon: Package,
    items: [
      { to: '/inventory', label: 'Stock Levels', icon: Package, permission: 'inventory:read' },
      { to: '/inventory/ledger', label: 'Stock Ledger', icon: ScrollText, permission: 'inventory:read' },
      { to: '/inventory/count', label: 'Stock Count', icon: ClipboardList, permission: 'inventory_count:read' },
      { to: '/inventory/adjustments', label: 'Stock Adjustments', icon: Scale, permission: 'inventory:move' },
      { to: '/inventory/transfers', label: 'Stock Transfers', icon: Truck, permission: 'inventory:move' },
      { to: '/inventory/locations', label: 'Locations', icon: MapPin, permission: PERMISSIONS.inventoryLocation.read },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/uom', label: 'Units of Measure', icon: Ruler },
    ],
  },
  {
    title: 'Repair & Maintenance',
    icon: Wrench,
    flag: 'VITE_ENABLE_REPAIR',
    items: [
      { to: '/repair', label: 'Dashboard', icon: Wrench, permission: PERMISSIONS.repair.read },
      { to: '/repair/orders', label: 'Repair Orders', icon: FileText, permission: PERMISSIONS.repair.read },
      { to: '/repair/jobs', label: 'Work Orders', icon: ClipboardCheck, permission: PERMISSIONS.repair.read },
      { to: '/repair/technicians', label: 'Technicians', icon: Users, permission: PERMISSIONS.repair.read },
      { to: '/repair/labour', label: 'Labour Catalog', icon: Timer, permission: PERMISSIONS.repair.read },
      { to: '/repair/warranties', label: 'Warranties', icon: ShieldCheck, permission: PERMISSIONS.repair.read },
      { to: '/repair/contracts', label: 'Service Contracts', icon: Handshake, permission: PERMISSIONS.repair.read },
      { to: '/repair/reports', label: 'Reports', icon: BarChart3, permission: PERMISSIONS.repair.read },
    ],
  },
  {
    title: 'Fixed Assets',
    icon: Landmark,
    items: [
      { to: '/fixed-assets', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/fixed-assets/register', label: 'Asset Register', icon: Building2 },
      { to: '/fixed-assets/categories', label: 'Categories', icon: Tag },
    ],
  },
  {
    title: 'Task Management',
    icon: ClipboardList,
    items: [
      { to: '/tasks', label: 'Task Board', icon: ClipboardList },
    ],
  },
  {
    title: 'Settings',
    icon: SettingsIcon,
    items: [
      { to: '/approvals', label: 'Approvals', icon: ShieldCheck, permission: 'approvals:read' },
      { to: '/approval-workflows', label: 'Approval Workflows', icon: Shield, permission: 'approvals:read' },
      { to: '/approval-policies', label: 'Approval Policies (legacy)', icon: Shield, permission: 'approvals:read' },
      { to: '/staff', label: 'Staff', icon: UserCog, permission: PERMISSIONS.user.read },
      { to: '/staff/roles', label: 'Roles & Permissions', icon: Shield, permission: PERMISSIONS.role.read },
      { to: '/settings/devices', label: 'Offline devices', icon: Smartphone, permission: PERMISSIONS.organization.read },
      { to: '/settings/company', label: 'Company Settings', icon: Landmark, permission: PERMISSIONS.setting.read },
      { to: '/settings/developer', label: 'Developer Settings', icon: SettingsIcon, permission: PERMISSIONS.setting.read },
      // Plain-language walkthrough of the school year and who does what.
      { to: '/school/guide', label: 'How it works', icon: BookOpen, permission: PERMISSIONS.school.read },
    ],
  },
];

// Flags are build-time constants under Vite, so this resolves once.
const VISIBLE_SECTIONS = NAV_SECTIONS.filter((s) => flagEnabled(s.flag));

/**
 * The permission a route needs, taken from the same menu entries that decide
 * what is shown. Hiding a link is not security (the API is the authority), but
 * typing a URL should not render a screen whose every request will 403.
 * Longest matching menu path wins; routes with no menu entry need none.
 */
type RequiredPermission = string | readonly string[];
const ROUTE_PERMISSIONS: Array<[string, RequiredPermission]> = NAV_SECTIONS.flatMap((section) =>
  section.items.filter((i) => i.permission).map((i) => [i.to, i.permission!] as [string, RequiredPermission]),
).sort((a, b) => b[0].length - a[0].length);

/** True when `has` satisfies the requirement (any one of an array). */
export function satisfies(required: RequiredPermission | undefined, has: (p: string) => boolean): boolean {
  if (!required) return true;
  return typeof required === 'string' ? has(required) : required.some(has);
}

export function routePermission(pathname: string): RequiredPermission | undefined {
  const hit = ROUTE_PERMISSIONS.find(([to]) => pathname === to || pathname.startsWith(`${to}/`));
  return hit?.[1];
}

// Collapsed (icon-only) sidebar keeps sections flat; accordion is only for expanded mode.
const SIDEBAR_EXPAND_STATE_KEY = 'poscafe.sidebar.expandedSections';
const SIDEBAR_COLLAPSED_KEY = 'poscafe.sidebar.collapsed';

// Localized section titles for the accordion parent buttons.
const SECTION_TITLE_KEYS: Record<string, string> = {
  Communication: 'nav.communication',
  POS: 'nav.pos',
  'Master Data': 'nav.masterData',
  Sales: 'nav.sales',
  CRM: 'nav.crm',
  School: 'nav.school',
  Inventory: 'nav.inventory',
  'Beverage Control': 'nav.beverageControl',
  Rentals: 'nav.rentals',
  'Repair & Maintenance': 'nav.repairMaintenance',
  'Human Resources': 'nav.workforce',
  Purchasing: 'nav.purchasing',
  Expenses: 'nav.expenses',
  'Cash Flow': 'nav.cashFlow',
  Tasks: 'nav.tasks',
  'Task Management': 'nav.taskManagement',
  Accounting: 'nav.accounting',
  'Fixed Assets': 'nav.fixedAssets',
  Manufacturing: 'nav.manufacturing',
  Bakery: 'nav.bakery',
  Settings: 'nav.settings',
};

const sectionTitle = (title: string | undefined, t: (k: string) => string) =>
  title ? (SECTION_TITLE_KEYS[title] ? t(SECTION_TITLE_KEYS[title]) : title) : '';

/**
 * The one menu entry the current URL belongs to. Entries that differ only by
 * `?tab=` (Meals, Transport, Messaging) would all light up under NavLink's
 * path matching, so a query-string entry wins only when its params match, and
 * the longest matching path wins overall.
 */
function activeItemKey(items: NavItem[], pathname: string, search: string): string | null {
  const current = new URLSearchParams(search);
  let best: { to: string; score: number } | null = null;
  for (const item of items) {
    const [path, query] = item.to.split('?');
    const pathHit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (!pathHit) continue;
    let score = path.length;
    if (query) {
      const wanted = new URLSearchParams(query);
      const ok = Array.from(wanted.entries()).every(([k, v]) => current.get(k) === v);
      if (!ok) continue;
      score += 1000;
    }
    if (!best || score > best.score) best = { to: item.to, score };
  }
  return best?.to ?? null;
}

type SidebarVars = CSSProperties & Record<`--${string}`, string>;

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme: sb } = useSidebarTheme();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const clear = useAuthStore((s) => s.clear);
  const org = useAuthStore((s) => s.organization);
  const setOrganization = useAuthStore((s) => s.setOrganization);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const onTerminal = location.pathname.startsWith('/pos/terminal');
  // The POS terminal always runs on the icon rail; elsewhere the user's choice sticks.
  const sidebarCollapsed = onTerminal || userCollapsed;
  const toggleCollapsed = () => {
    const next = !sidebarCollapsed;
    setUserCollapsed(next);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  // Accordion state: which titled sections are expanded (expanded sidebar only).
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_EXPAND_STATE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const persistExpanded = (next: Record<string, boolean>) => {
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPAND_STATE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  };
  const toggleSection = (title: string) =>
    persistExpanded({ ...expanded, [title]: !expanded[title] });

  // Sections switched off in Developer Settings → Sidebar Modules.
  const { data: orgFeatures } = useOrgFeatures();
  const visibleSections = useMemo(
    () =>
      VISIBLE_SECTIONS.filter((s) => isSectionEnabled(orgFeatures, s.title)).map((s) => ({
        ...s,
        items: s.items.filter((i) => flagEnabled(i.flag) && satisfies(i.permission, hasPermission)),
      })).filter((s) => s.items.length > 0),
    [hasPermission, orgFeatures],
  );
  const allItems = useMemo(() => visibleSections.flatMap((s) => s.items), [visibleSections]);
  const activeTo = activeItemKey(allItems, location.pathname, location.search);
  const activeSection = visibleSections.find((s) => s.items.some((i) => i.to === activeTo));

  // Keep the section holding the current page open, so it is never hidden.
  useEffect(() => {
    if (activeSection?.title && !expanded[activeSection.title]) {
      persistExpanded({ ...expanded, [activeSection.title]: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection?.title]);

  // Bring the current page's menu entry into view once its section has opened.
  useEffect(() => {
    const id = window.setTimeout(() => {
      // Scroll only the menu itself; scrollIntoView would also move the page.
      document.querySelectorAll<HTMLElement>('aside nav [aria-current="page"]').forEach((el) => {
        const nav = el.closest('nav');
        if (!nav) return;
        const r = el.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        if (r.top < n.top || r.bottom > n.bottom) nav.scrollTop += r.top - n.top - n.height / 2 + r.height / 2;
      });
    }, 320);
    return () => window.clearTimeout(id);
  }, [activeTo, mobileOpen]);

  // Keep the org (incl. base currency) in sync with the server on boot.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/organizations/me')
      .then((res) => {
        if (cancelled || !res.data?.id) return;
        const o = res.data;
        setOrganization({
          id: o.id,
          code: o.code,
          name: o.name,
          currencyCode: o.currencyCode,
          timezone: o.timezone,
        });
      })
      .catch(() => {
        /* token invalid — protected route handles it */
      });
    return () => {
      cancelled = true;
    };
  }, [setOrganization]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Every table on every screen gets search and column sorting.
  useEffect(() => (mainRef.current ? enhanceTablesIn(mainRef.current) : undefined), []);

  // Close mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const currentItem = allItems.find((i) => i.to === activeTo);
  const current = currentItem?.label ?? (location.pathname === '/' ? 'Dashboard' : '');
  const currentSection = activeSection?.title ? sectionTitle(activeSection.title, t) : '';

  const logout = () => {
    serverLogout();
    clear();
    navigate('/login', { replace: true });
  };

  // Hide the app-shell header (Theme / User profile) on the full-screen POS
  // selling terminal — the Terminal's own Topbar covers those controls.
  const hideHeader = onTerminal;

  const initials = `${(user?.firstName?.[0] ?? '').toUpperCase()}${(user?.lastName?.[0] ?? '').toUpperCase()}` || '?';

  const sidebarVars: SidebarVars = {
    background: sb.sidebar,
    color: sb.sidebarText,
    '--sb-text': sb.sidebarText,
    '--sb-muted': sb.sidebarMuted,
    '--sb-hover': sb.sidebarHover,
    '--sb-active': sb.sidebarActive,
    '--sb-active-bg': sb.sidebarActiveBg,
    '--sb-bar': sb.sidebarActiveBar,
    '--sb-border': sb.sidebarBorder,
  };

  const itemLink = (item: NavItem, onItemClick?: () => void, withIcon = false) => {
    const Icon = item.icon;
    const active = item.to === activeTo;
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onItemClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex h-8 items-center gap-2.5 rounded-lg pr-2 text-[13.5px] outline-none transition-[background-color,color] duration-150',
          'text-[color:var(--sb-text)] hover:bg-[var(--sb-hover)] hover:text-[color:var(--sb-active)] focus-visible:ring-2 focus-visible:ring-[color:var(--sb-bar)] focus-visible:ring-offset-0',
          withIcon ? 'pl-2.5' : 'pl-3',
          active && 'bg-[var(--sb-active-bg)] font-medium text-[color:var(--sb-active)] hover:bg-[var(--sb-active-bg)]',
        )}
      >
        {!withIcon && (
          // The section's guide line; the active entry lights its own segment.
          <span
            aria-hidden
            className={cn(
              'absolute -left-[9px] top-1.5 bottom-1.5 w-[2px] rounded-full transition-colors',
              active ? 'bg-[var(--sb-bar)]' : 'bg-transparent',
            )}
          />
        )}
        {withIcon && <Icon className={cn('h-4 w-4 shrink-0 opacity-80', active && 'opacity-100')} />}
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <span
            className="rounded-full px-1.5 py-px text-[10px] font-bold text-white"
            style={{ background: sb.badgeBg }}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const renderExpandedNav = (onItemClick?: () => void) => (
    <nav className="sb-scroll flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-1" aria-label="Main">
      {visibleSections.map((section, idx) => {
        if (!section.title) {
          return (
            <div key={`top-${idx}`} className="mb-2 space-y-0.5">
              {section.items.map((item) => itemLink(item, onItemClick, true))}
            </div>
          );
        }
        const title = section.title;
        const isOpen = !!expanded[title];
        const SectionIcon = section.icon ?? LayoutDashboard;
        const holdsActive = section.items.some((i) => i.to === activeTo);
        return (
          <div key={title} className="mt-0.5">
            <button
              type="button"
              onClick={() => toggleSection(title)}
              aria-expanded={isOpen}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium outline-none transition-colors',
                'text-[color:var(--sb-text)] hover:bg-[var(--sb-hover)] focus-visible:ring-2 focus-visible:ring-[color:var(--sb-bar)] focus-visible:ring-offset-0',
                holdsActive && 'text-[color:var(--sb-active)]',
              )}
            >
              <SectionIcon className={cn('h-4 w-4 shrink-0 opacity-80', holdsActive && 'opacity-100')} />
              <span className="flex-1 truncate text-left">{sectionTitle(title, t)}</span>
              {holdsActive && !isOpen && (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--sb-bar)]" />
              )}
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-[color:var(--sb-muted)] transition-transform duration-200',
                  isOpen && 'rotate-90',
                )}
              />
            </button>
            {/* grid-rows 0fr→1fr animates to the content's real height. */}
            <div
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
              // Closed sections keep their links out of the tab order (React 18 has no `inert` prop type).
              {...({ inert: isOpen ? undefined : '' } as Record<string, string | undefined>)}
            >
              <div className="overflow-hidden">
                <div className="relative mb-1.5 ml-[17px] mt-0.5 space-y-px border-l border-[color:var(--sb-border)] pl-2">
                  {section.items.map((item, itemIdx) => {
                    const prev = section.items[itemIdx - 1];
                    const showGroup = item.group && item.group !== prev?.group;
                    return (
                      <Fragment key={item.to}>
                        {showGroup && (
                          <div className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--sb-muted)]">
                            {item.group}
                          </div>
                        )}
                        {itemLink(item, onItemClick)}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );

  const railButton =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl outline-none transition-colors text-[color:var(--sb-text)] hover:bg-[var(--sb-hover)] hover:text-[color:var(--sb-active)] focus-visible:ring-2 focus-visible:ring-[color:var(--sb-bar)] focus-visible:ring-offset-0';

  // Icon rail: one button per section, each opening its pages in a flyout.
  const renderRail = () => (
    <nav className="sb-scroll flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-2" aria-label="Main">
      {visibleSections.map((section, idx) => {
        if (!section.title) {
          return section.items.map((item) => {
            const Icon = item.icon;
            const active = item.to === activeTo;
            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.to}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(railButton, active && 'bg-[var(--sb-active-bg)] text-[color:var(--sb-active)]')}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          });
        }
        const SectionIcon = section.icon ?? LayoutDashboard;
        const holdsActive = section.items.some((i) => i.to === activeTo);
        const label = sectionTitle(section.title, t);
        return (
          <Fragment key={section.title}>
            {idx > 0 && !visibleSections[idx - 1].title && (
              <div aria-hidden className="my-1 h-px w-8 shrink-0 bg-[var(--sb-border)]" />
            )}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger
                    aria-label={label}
                    className={cn(railButton, 'relative', holdsActive && 'bg-[var(--sb-active-bg)] text-[color:var(--sb-active)]')}
                  >
                    <SectionIcon className="h-[18px] w-[18px]" />
                    {holdsActive && (
                      <span aria-hidden className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--sb-bar)]" />
                    )}
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" sideOffset={10} className="max-h-[70vh] w-60 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {label}
                </DropdownMenuLabel>
                {section.items.map((item, itemIdx) => {
                  const Icon = item.icon;
                  const prev = section.items[itemIdx - 1];
                  const showGroup = item.group && item.group !== prev?.group;
                  const active = item.to === activeTo;
                  return (
                    <Fragment key={item.to}>
                      {showGroup && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {item.group}
                          </div>
                        </>
                      )}
                      <DropdownMenuItem asChild className={cn('cursor-pointer gap-2', active && 'bg-primary/10 font-medium text-foreground')}>
                        <Link to={item.to} aria-current={active ? 'page' : undefined}>
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </DropdownMenuItem>
                    </Fragment>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </Fragment>
        );
      })}
    </nav>
  );

  const brand = (collapsed: boolean, onClose?: () => void) => (
    <div className={cn('flex h-16 shrink-0 items-center gap-3', collapsed ? 'justify-center px-2' : 'px-4')}>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-[0_4px_12px_-2px_rgba(0,0,0,0.35)] ring-1 ring-white/20"
        style={{ background: sb.brandBg }}
      >
        <School className="h-[18px] w-[18px] text-white" />
      </div>
      {!collapsed && (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--sb-active)]">
            {org?.name ?? 'School Management'}
          </span>
          <span className="truncate text-[11px] leading-tight text-[color:var(--sb-muted)]">School Management</span>
        </div>
      )}
      {onClose && (
        <button type="button" onClick={onClose} className={cn(railButton, 'h-8 w-8')} aria-label="Close menu">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const userCard = (collapsed: boolean, inDrawer = false) => (
    <div className={cn('shrink-0 border-t border-[color:var(--sb-border)]', collapsed ? 'flex flex-col items-center gap-1 px-2 py-3' : 'flex items-center gap-2.5 px-3 py-3')}>
      {!collapsed && (
        <>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white ring-2 ring-white/15"
            style={{ background: sb.brandBg }}
            aria-hidden
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-[color:var(--sb-active)]">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="truncate text-[11.5px] text-[color:var(--sb-muted)]">{user?.email}</div>
          </div>
        </>
      )}
      {!onTerminal && !inDrawer && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(railButton, 'h-8 w-8 rounded-lg text-[color:var(--sb-muted)]')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen bg-background">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-black/10 transition-[width] duration-200 ease-out md:flex print:hidden',
            sidebarCollapsed ? 'w-[76px]' : 'w-[272px]',
          )}
          style={sidebarVars}
        >
          {brand(sidebarCollapsed)}
          {sidebarCollapsed ? renderRail() : (
            <>
              {renderExpandedNav()}
            </>
          )}
          {userCard(sidebarCollapsed)}
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-in fade-in-0" onClick={() => setMobileOpen(false)} />
            <aside
              className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col shadow-2xl animate-in slide-in-from-left duration-200"
              style={sidebarVars}
            >
              {brand(false, () => setMobileOpen(false))}
              {renderExpandedNav(() => setMobileOpen(false))}
              {userCard(false, true)}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!hideHeader && (
            <header className="app-shell-header sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/70 bg-background/80 px-3 backdrop-blur-md print:hidden md:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 md:hidden"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
                  {currentSection && (
                    <>
                      <span className="hidden truncate text-muted-foreground sm:inline">{currentSection}</span>
                      <ChevronRight aria-hidden className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:inline" />
                    </>
                  )}
                  <span className="truncate font-semibold text-foreground">{current}</span>
                </nav>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/70 lg:flex"
                >
                  <Search className="h-4 w-4" />
                  <span className="flex-1 text-left">Search…</span>
                  <kbd className="rounded border border-border bg-background px-1.5 font-sans text-[10px] font-medium">Ctrl K</kbd>
                </button>
                <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
                  <Search className="h-[18px] w-[18px]" />
                </Button>
                <ThemePicker />
                <HeaderComms />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                        style={{ background: sb.brandBg }}
                        aria-hidden="true"
                      >
                        {initials}
                      </span>
                      <span className="hidden text-sm font-medium text-foreground sm:inline">
                        {user?.firstName}
                      </span>
                      <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:inline" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        {user?.firstName} {user?.lastName}
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {user?.email}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5">
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Active Branch
                      </label>
                      <BranchSwitcher />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{t('auth.signOut')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
          )}

          <main ref={mainRef} className="flex-1 overflow-auto p-1 md:p-1">
            <RouteErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>

        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        <PushBootstrap />
      </div>
    </TooltipProvider>
  );
}
