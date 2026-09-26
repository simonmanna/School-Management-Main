import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeaderComms } from './header-comms';
import {
  LayoutDashboard,
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
  HardDrive,
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
  permission?: string;
  badge?: string;
  /** Optional sub-grouping label rendered as a sub-header above the item (expanded mode only). */
  group?: string;
  /** Per-item feature gate, resolved the same way as section flags. */
  flag?: 'VITE_ENABLE_BEVERAGE' | 'VITE_ENABLE_ASSETS' | 'VITE_ENABLE_TASKS' | 'VITE_ENABLE_MANUFACTURING' | 'VITE_ENABLE_RENTAL' | 'VITE_ENABLE_REPAIR' | 'VITE_ENABLE_HR' | 'VITE_ENABLE_ORDERS' | 'VITE_ENABLE_COMMUNICATION' | 'VITE_ENABLE_SCHOOL' | 'VITE_ENABLE_ADVANCED_LMS';
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
  flag?: 'VITE_ENABLE_BEVERAGE' | 'VITE_ENABLE_ASSETS' | 'VITE_ENABLE_TASKS' | 'VITE_ENABLE_MANUFACTURING' | 'VITE_ENABLE_RENTAL' | 'VITE_ENABLE_REPAIR' | 'VITE_ENABLE_HR' | 'VITE_ENABLE_ORDERS' | 'VITE_ENABLE_COMMUNICATION' | 'VITE_ENABLE_SCHOOL' | 'VITE_ENABLE_ADVANCED_LMS';
}

const flagEnabled = (flag?: string): boolean =>
  !flag || (import.meta.env as Record<string, string | undefined>)[flag] === 'true';

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      // Plain-language walkthrough of the school year and who does what.
      { to: '/school/guide', label: 'How it works', icon: BookOpen, permission: PERMISSIONS.school.read },
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
      { to: '/school/management/student-categories', label: 'Student Categories', icon: Tag, permission: PERMISSIONS.school.manageFoundation },
      { to: '/school/promotion', label: 'Promote & Roll Over', icon: TrendingUp, permission: PERMISSIONS.school.manageStudents },
      { to: '/school/portals', label: 'Parent & Pupil Portals', icon: GraduationCap, permission: PERMISSIONS.school.read },
      { to: '/school/analytics', label: 'Analytics', icon: BarChart3, permission: PERMISSIONS.school.read },
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
  {
    title: 'Admissions',
    icon: FilePlus2,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      // The journey in the order a school walks it: applications arrive,
      // somebody decides, the applicant is enrolled and seated. Configuration
      // and analytics sit below it rather than beside it.
      { to: '/school/applications', label: 'Applications', icon: FileText, permission: PERMISSIONS.school.manageAdmissions },
      { to: '/school/admissions', label: 'Review & Enrol', icon: FilePlus2, permission: PERMISSIONS.school.read },
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

      { to: '/school/homework', label: 'Homework Submissions', icon: ClipboardList, permission: PERMISSIONS.school.manageAssignments, group: 'Tools' },
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
    ],
  },
  {
    // Release has ONE owner. "Report Cards" and "Results & Reports" both looked
    // like the place a term is published from, and only one of them goes through
    // the immutable ResultSet the portal is served from. Computing and publishing
    // leads; the documents that fall out of it follow.
    title: 'Results',
    icon: GitBranch,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/results', label: 'Compute & Publish Results', icon: GitBranch, permission: PERMISSIONS.school.computeResults },
      { to: '/school/report-cards', label: 'Report Documents', icon: FileText, permission: PERMISSIONS.school.manageExams },
      { to: '/school/exam-results', label: 'Exam Results', icon: BarChart3, permission: PERMISSIONS.school.read },
      { to: '/school/competency-report', label: 'Competency & Annual', icon: GraduationCap, permission: PERMISSIONS.school.read },
      { to: '/school/certification', label: 'Certification', icon: FileBadge, permission: PERMISSIONS.school.read },
      { to: '/school/reports', label: 'Report Centre', icon: BarChart3, permission: PERMISSIONS.school.readReports, group: 'Reports' },
      { to: '/school/report-card-settings', label: 'Report Card Design', icon: SlidersHorizontal, permission: PERMISSIONS.school.manageExams, group: 'Setup' },
    ],
  },
  {
    title: 'Attendances',
    icon: ClipboardCheck,
    flag: 'VITE_ENABLE_SCHOOL',
    items: [
      { to: '/school/attendance', label: 'Attendance', icon: ClipboardCheck, permission: PERMISSIONS.school.takeAttendance },
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
      { to: '/school/fees', label: 'Fees & Billing', icon: Receipt, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/categories', label: 'Fee Categories', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/structures', label: 'Fee Structures', icon: Layers, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/optional', label: 'Optional Fees', icon: Ticket, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/schedules', label: 'Fee Schedules', icon: CalendarClock, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/dashboard', label: 'Finance Dashboard', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/invoices', label: 'Fee Invoices', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/ledger', label: 'Student Ledger', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/billing-runs', label: 'Billing Runs', icon: Receipt, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/adjustments', label: 'Adjustments', icon: Receipt, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/reconciliation', label: 'Payment Reconciliation', icon: HandCoins, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/term-close', label: 'Term Close', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/collect', label: 'Record Fee Payments', icon: HandCoins, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/bulk-collect', label: 'Bulk Collection', icon: HandCoins, permission: PERMISSIONS.school.collectPayments },
      { to: '/school/fees/receipts', label: 'Receipts & Reprints', icon: Receipt, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/mobile-money', label: 'Mobile Money', icon: Smartphone, permission: PERMISSIONS.school.collectPayments },
      { to: '/school/fees/explain', label: 'Explain a Balance', icon: HelpCircle, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/clearance', label: 'Fee Clearance', icon: ShieldCheck, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/statement', label: 'Fee Statement', icon: FileText, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/cash-book', label: 'Daily Cash Book', icon: Banknote, permission: PERMISSIONS.school.readFees },
      { to: '/school/fees/discounts', label: 'Discounts', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/overrides', label: 'Fee Overrides', icon: Ticket, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/waiver-categories', label: 'Waiver Categories', icon: Tag, permission: PERMISSIONS.school.manageFees },
      { to: '/school/fees/waivers', label: 'Fee Waivers', icon: Ticket, permission: PERMISSIONS.school.manageFees },
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
      { to: '/settings/backup', label: 'Backup', icon: HardDrive, permission: PERMISSIONS.backup.read },
      { to: '/settings/company', label: 'Company Settings', icon: Landmark, permission: PERMISSIONS.setting.read },
      { to: '/settings/developer', label: 'Developer Settings', icon: SettingsIcon, permission: PERMISSIONS.setting.read },
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
const ROUTE_PERMISSIONS: Array<[string, string]> = NAV_SECTIONS.flatMap((section) =>
  section.items.filter((i) => i.permission).map((i) => [i.to, i.permission!] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

export function routePermission(pathname: string): string | undefined {
  const hit = ROUTE_PERMISSIONS.find(([to]) => pathname === to || pathname.startsWith(`${to}/`));
  return hit?.[1];
}

// Collapsed (icon-only) sidebar keeps sections flat; accordion is only for expanded mode.
const SIDEBAR_EXPAND_STATE_KEY = 'poscafe.sidebar.expandedSections';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // Auto-expand the section containing the active route so it's never hidden.
  const [autoExpanded, setAutoExpanded] = useState(false);
  useEffect(() => {
    if (sidebarCollapsed || autoExpanded) return;
    const activeSection = VISIBLE_SECTIONS.find(
      (s) =>
        s.title &&
        s.items.some(
          (n) => n.to !== '/' && (location.pathname === n.to || location.pathname.startsWith(`${n.to}/`)),
        ),
    );
    if (activeSection?.title && !expanded[activeSection.title]) {
      persistExpanded({ ...expanded, [activeSection.title]: true });
    }
    setAutoExpanded(true);
  }, [location.pathname, sidebarCollapsed]);

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

  // Auto-collapse sidebar on POS terminal, restore on other pages.
  useEffect(() => {
    setSidebarCollapsed(location.pathname.startsWith('/pos/terminal'));
  }, [location.pathname]);
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

  // Close mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const allItems = VISIBLE_SECTIONS.flatMap((s) => s.items);
  const current =
    allItems.find(
      (n) =>
        n.to !== '/' &&
        (location.pathname === n.to || location.pathname.startsWith(`${n.to}/`)),
    )?.label ?? (location.pathname === '/' ? 'Dashboard' : '');

  const logout = () => {
    serverLogout();
    clear();
    navigate('/login', { replace: true });
  };

  // Hide the app-shell header (Theme / User profile) on the full-screen POS
  // selling terminal — the Terminal's own Topbar covers those controls.
  const hideHeader = location.pathname.startsWith('/pos/terminal');

  // ── Sidebar rendering: themed background, brand tile, themed nav items ──
  const renderNav = (onItemClick?: () => void, collapsed = false) => {
    return (
      <nav className="flex-1 space-y-1 overflow-y-auto px-1 py-1">
        {VISIBLE_SECTIONS.map((section, idx) => {
          const items = section.items.filter(
                      (i) => flagEnabled(i.flag) && (!i.permission || hasPermission(i.permission)),
                    );
          if (items.length === 0) return null;
          // In collapsed (icon-rail) mode the accordion is hidden, so always
          // show the items regardless of accordion open-state — otherwise every
          // titled section's icons would vanish when the sidebar collapses.
          const isOpen = collapsed || !section.title || expanded[section.title];
          return (
            <div key={idx} className="space-y-0">
              {section.title && !collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.title as string)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-[13px] font-semibold uppercase tracking-[0.03em] transition-colors hover:bg-white/10"
                  style={{ color: sb.sidebarActive, borderBottom: `1px solid ${sb.sidebarBorder}`, marginBottom: 2 }}
                  aria-expanded={isOpen}
                >
                  {section.icon && <section.icon className="h-4 w-4 shrink-0" />}
                  <span className="flex-1 truncate text-left">{sectionTitle(section.title, t)}</span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-150', !isOpen && '-rotate-90')}
                  />
                </button>
              ) : section.title && collapsed ? (
                <div
                  className="mx-2 my-1 border-t"
                  style={{ borderColor: sb.sidebarBorder }}
                  aria-hidden
                />
              ) : null}
              {isOpen &&
                items.map((item, itemIdx) => {
                const Icon = item.icon;
                // Sub-group sub-header: show once when the group label changes (expanded mode).
                const prev = items[itemIdx - 1];
                const showGroup = !collapsed && item.group && item.group !== prev?.group;
                return (
                  <Fragment key={item.to}>
                    {showGroup && (
                      <div
                        className="px-3 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
                        style={{ color: sb.sidebarMuted }}
                      >
                        {item.group}
                      </div>
                    )}
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onItemClick}
                    className={() =>
                      cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-all duration-150',
                        collapsed && 'justify-center px-2',
                      )
                    }
                    style={({ isActive }) => ({
                      color: isActive ? sb.sidebarActive : sb.sidebarText,
                      background: isActive ? sb.sidebarActiveBg : 'transparent',
                      fontWeight: isActive ? 600 : 400,
                    })}
                    onMouseEnter={(e) => {
                      const a = (e.currentTarget as HTMLElement);
                      if (!a.style.background || a.style.background === 'transparent' || a.style.background === '') {
                        a.style.background = sb.sidebarHover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      const el = (e.currentTarget as HTMLElement);
                      el.style.background = '';
                    }}
                    title={collapsed ? item.label : undefined}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
                            style={{ background: sb.sidebarActiveBar }}
                          />
                        )}
                        <Icon className="h-4 w-4 shrink-0" style={{ width: 16, height: 16 }} />
                        {!collapsed && <span className="flex-1 truncate tracking-[0.01em]">{item.label}</span>}
                        {item.badge && !collapsed && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                            style={{ background: sb.badgeBg, minWidth: 18, textAlign: 'center', lineHeight: 'tight' }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                  </Fragment>
                );
                })}
            </div>
          );
        })}
      </nav>
    );
  };

  // ── Brand tile + section heading text inside the sidebar ──
  const sidebarInner = (collapsed = false) => {
    const toggle = () => setSidebarCollapsed((c) => !c);
    return (
      <div className="flex h-full flex-col" style={{ background: sb.sidebar }}>
        {/* Brand Header */}
        <div
          className="flex h-[58px] shrink-0 items-center gap-2 px-4"
          style={{ borderBottom: `1px solid ${sb.sidebarBorder}` }}
        >
          <div
            className="flex shrink-0 items-center justify-center rounded-xl"
            style={{
              width: 34,
              height: 34,
              background: sb.brandBg,
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            <School style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
          {!collapsed && (
            <div className="ml-1 flex flex-1 flex-col leading-none">
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16, letterSpacing: '-0.3px' }}>
                {org?.name ?? 'School Management'}
              </span>
              <span
                style={{
                  color: sb.sidebarMuted,
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginTop: 2,
                }}
              >
                School Management
              </span>
            </div>
          )}
          <button
            onClick={toggle}
            className="ml-auto flex shrink-0 items-center justify-center rounded-lg p-1 transition-colors hover:bg-white/10"
            style={{ color: sb.sidebarMuted }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {renderNav(() => setMobileOpen(false), collapsed)}

      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col transition-all duration-200 md:flex print:hidden',
          sidebarCollapsed ? 'w-20' : 'w-72',
        )}
        style={{ background: sb.sidebar }}
      >
        {sidebarInner(sidebarCollapsed)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col shadow-xl">
            {sidebarInner(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!hideHeader && (
          <header className="app-shell-header sticky top-0 z-30 flex h-11 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur print:hidden md:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:inline-flex"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="truncate text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{current}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <ThemePicker />
              <HeaderComms />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full px-1.5 py-1 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {(user?.firstName?.[0] ?? '').toUpperCase()}
                      {(user?.lastName?.[0] ?? '').toUpperCase()}
                    </span>
                    <span className="hidden text-sm font-medium text-foreground sm:inline">
                      {user?.firstName}
                    </span>
                    <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:inline" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
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

        <main
          className={`flex-1 overflow-auto ${
            location.pathname.startsWith('/pos/terminal') ? 'p-1 md:p-1' : 'p-1 md:p-1'
          }`}
        >
          <RouteErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <PushBootstrap />
    </div>
  );
}
