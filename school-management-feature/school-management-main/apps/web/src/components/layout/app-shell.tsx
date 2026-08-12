import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Package,
  Receipt,
  FileMinus,
  HandCoins,
  FileText,
  Banknote,
  Clock,
  BookOpen,
  BookText,
  ScrollText,
  Scale,
  Settings as SettingsIcon,
  Moon,
  Sun,
  LogOut,
  GraduationCap,
  UserCog,
  CalendarCheck,
  ClipboardList,
  DollarSign,
  Library,
  Bus,
  Bed,
  Utensils,
  Building2,
  BarChart3,
  Megaphone,
} from "lucide-react";
import { PERMISSIONS } from "@erp/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth.store";
import { useTheme } from "@/components/theme-provider";
import { useCampuses } from "@/features/school/api";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  { items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Master Data",
    items: [
      {
        to: "/partners",
        label: "Partners",
        icon: Users,
        permission: PERMISSIONS.partner.read,
      },
      {
        to: "/products",
        label: "Products",
        icon: Package,
        permission: PERMISSIONS.product.read,
      },
    ],
  },
  {
    title: "Sales",
    items: [
      {
        to: "/invoices",
        label: "Invoices",
        icon: Receipt,
        permission: PERMISSIONS.invoice.read,
      },
      {
        to: "/credit-notes",
        label: "Credit Notes",
        icon: FileMinus,
        permission: PERMISSIONS.creditNote.read,
      },
      {
        to: "/payments",
        label: "Receipts",
        icon: HandCoins,
        permission: PERMISSIONS.payment.read,
      },
      {
        to: "/ar-aging",
        label: "AR Aging",
        icon: Clock,
        permission: PERMISSIONS.report.ar,
      },
    ],
  },
  {
    title: "Purchases",
    items: [
      {
        to: "/expenses",
        label: "Expenses",
        icon: FileText,
        permission: PERMISSIONS.expense.read,
      },
      {
        to: "/supplier-payments",
        label: "Supplier Payments",
        icon: Banknote,
        permission: PERMISSIONS.payment.read,
      },
    ],
  },
  {
    title: "Accounting",
    items: [
      {
        to: "/accounts",
        label: "Chart of Accounts",
        icon: BookOpen,
        permission: PERMISSIONS.account.read,
      },
      {
        to: "/journals",
        label: "Journals",
        icon: BookText,
        permission: PERMISSIONS.journal.read,
      },
      {
        to: "/journal-entries",
        label: "Journal Entries",
        icon: ScrollText,
        permission: PERMISSIONS.journalEntry.read,
      },
      {
        to: "/trial-balance",
        label: "Trial Balance",
        icon: Scale,
        permission: PERMISSIONS.report.accounting,
      },
    ],
  },
  {
    // ─── School vertical (ADR-011) ───────────────────────────────────
    // Every item is gated by `school:*` permissions; users without
    // school access won't see this section at all.
    title: "School",
    items: [
      {
        to: "/school",
        label: "Overview",
        icon: GraduationCap,
        permission: PERMISSIONS.school.read,
      },
      {
        to: "/school/students",
        label: "Students",
        icon: Users,
        permission: PERMISSIONS.school.manageStudents,
      },
      {
        to: "/school/staff",
        label: "Staff",
        icon: UserCog,
        permission: PERMISSIONS.school.manageStaff,
      },
      {
        to: "/school/attendance",
        label: "Attendance",
        icon: CalendarCheck,
        permission: PERMISSIONS.school.takeAttendance,
      },
      {
        to: "/school/fees",
        label: "Fees",
        icon: DollarSign,
        permission: PERMISSIONS.school.manageFees,
      },
      {
        to: "/school/exams",
        label: "Exams",
        icon: ClipboardList,
        permission: PERMISSIONS.school.enterGrades,
      },
      {
        to: "/school/calendar",
        label: "Calendar",
        icon: CalendarCheck,
        permission: PERMISSIONS.school.read,
      },
      {
        to: "/school/library",
        label: "Library",
        icon: Library,
        permission: PERMISSIONS.school.manageLibrary,
      },
      {
        to: "/school/transport",
        label: "Transport",
        icon: Bus,
        permission: PERMISSIONS.school.manageTransport,
      },
      {
        to: "/school/hostel",
        label: "Hostel",
        icon: Bed,
        permission: PERMISSIONS.school.manageHostel,
      },
      {
        to: "/school/cafeteria",
        label: "Cafeteria",
        icon: Utensils,
        permission: PERMISSIONS.school.manageCafeteria,
      },
      {
        to: "/school/reports",
        label: "Reports",
        icon: BarChart3,
        permission: PERMISSIONS.school.read,
      },
      {
        to: "/school/portals",
        label: "Portals",
        icon: Megaphone,
        permission: PERMISSIONS.school.read,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        to: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        permission: PERMISSIONS.setting.read,
      },
    ],
  },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const clear = useAuthStore((s) => s.clear);

  // Multi-campus selector (Sprint 11 DoD). Only rendered when the user
  // has any school:* permission AND we're on a school route. We store the
  // selected campusId in localStorage so it survives reloads.
  const { data: campuses } = useCampuses();
  const schoolSection = NAV_SECTIONS.find((s) => s.title === "School");
  const showCampusFilter =
    schoolSection?.items.some((i) => i.permission && hasPermission(i.permission)) &&
    location.pathname.startsWith("/school");

  const selectedCampusId =
    typeof window !== "undefined" ? localStorage.getItem("school.campusId") ?? "all" : "all";

  const setCampus = (id: string) => {
    localStorage.setItem("school.campusId", id);
    // Trigger re-render of pages that depend on the filter.
    window.dispatchEvent(new CustomEvent("school:campus-change", { detail: { campusId: id } }));
  };

  const allItems = NAV_SECTIONS.flatMap((s) => s.items);
  const current =
    allItems.find(
      (n) =>
        n.to !== "/" &&
        (location.pathname === n.to ||
          location.pathname.startsWith(`${n.to}/`)),
    )?.label ?? (location.pathname === "/" ? "Dashboard" : "");

  const logout = () => {
    clear();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex print:hidden">
        <div className="flex h-14 items-center border-b px-6 font-semibold">
          <Building2 className="mr-2 h-5 w-5" /> Sunrise ERP
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_SECTIONS.map((section, idx) => {
            const items = section.items.filter(
              (i) => !i.permission || hasPermission(i.permission),
            );
            if (items.length === 0) return null;
            return (
              <div key={idx} className="space-y-1">
                {section.title && (
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </p>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6 print:hidden">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{current}</span>
            {showCampusFilter && (campuses ?? []).length > 0 && (
                          <select
                            className="h-8 rounded border bg-background px-2 text-xs"
                            value={selectedCampusId}
                            onChange={(e) => setCampus(e.target.value)}
                          >
                            <option value="all">All campuses</option>
                            {(campuses ?? []).map((c: any) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.firstName} {user?.lastName}
            </span>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}