import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/protected-route';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { PartnersPage } from '@/pages/partners';
import { CustomersPage, CustomerDetailPage } from '@/pages/customers';
import { SuppliersPage, SupplierDetailPage } from '@/pages/suppliers';
import { SupplierLedgerPage } from '@/pages/purchasing/supplier-ledger';
import { ProductsPage } from '@/pages/products';
import { UomPage } from '@/pages/uom';
import { MenuPage } from '@/pages/menu';
import MenuDetailPage from '@/pages/menu/MenuDetailPage';
import ModifiersPage from '@/pages/menu/ModifiersPage';
import ComboListPage from '@/pages/pos/ComboListPage';
import AccompanimentGroupsPage from '@/pages/menu/AccompanimentGroupsPage';
import { SettingsPage } from '@/pages/settings';
import { DevCompanySettingsPage } from '@/pages/settings/DevCompanySettingsPage';
import { CompanySettingsPage } from '@/pages/settings/CompanySettingsPage';
import { ReceiptSettingsPage } from '@/pages/pos/ReceiptSettingsPage';
import { DevicesPage } from '@/pages/pos/DevicesPage';
import { DeadLettersPage } from '@/pages/pos/DeadLettersPage';
import { PostingMonitorPage } from '@/pages/pos/PostingMonitorPage';
import { ApprovalsPage } from '@/pages/approvals';
import { ApprovalPoliciesPage } from '@/pages/approval-policies';
import { ApprovalWorkflowsPage } from '@/pages/approval-workflows';
import { RecurringPage } from '@/pages/recurring';
import { WebhooksPage } from '@/pages/webhooks';
import { FilesPage } from '@/pages/files';
import { ModulesPage } from '@/pages/modules';
import { CrmDashboardPage } from '@/pages/crm/dashboard';
import { SchoolDashboardPage } from '@/pages/school/dashboard';
import { SchoolStudentsPage } from '@/pages/school/students';
import { SchoolStudent360Page } from '@/pages/school/student-360';
import { SchoolFeesPage } from '@/pages/school/fees';
import { SchoolFeeCategoriesPage } from '@/pages/school/fee-categories';
import { SchoolFeeStructuresPage } from '@/pages/school/fee-structures';
import { SchoolOptionalFeesPage } from '@/pages/school/optional-fees';
import { SchoolFeeSchedulesPage } from '@/pages/school/fee-schedules';
import { SchoolFeesCollectPage } from '@/pages/school/fees-subpages';
import { SchoolWaiverCategoriesPage } from '@/pages/school/fees-subpages';
import { SchoolWaiversPage } from '@/pages/school/fees-subpages';
import { SchoolFeeDefaultersPage } from '@/pages/school/fees-subpages';
import { SchoolBadDebtorsPage } from '@/pages/school/fees-subpages';
import { SchoolBudgetingPage } from '@/pages/school/fees-subpages';
import {
  SchoolReceiptsPage,
  SchoolBulkCollectPage,
  SchoolFeeClearancePage,
  SchoolFeeStatementPage,
  SchoolCashBookPage,
  SchoolDiscountsPage,
  SchoolFeeOverridesPage,
} from '@/pages/school/fees-operations';
import { SchoolMobileMoneyPage, SchoolBalanceExplainerPage } from '@/pages/school/fees-momo';
import {
  SchoolStudentLedgerPage,
  SchoolFinanceDashboardPage,
  SchoolBillingRunsPage,
  SchoolAdjustmentsPage,
  SchoolReconciliationPage,
  SchoolInvoicesPage,
} from '@/pages/school/finance-pages';
import { SchoolAttendancePage } from '@/pages/school/attendance';
import { SchoolAttendanceStatusesPage } from '@/pages/school/attendance-statuses';
import { SchoolAttendanceReportPage } from '@/pages/school/attendance-report';
import { SchoolTimetablePage } from '@/pages/school/timetable';
import { SchoolTripsPage } from '@/pages/school/trips';
import { SchoolTransportPage } from '@/pages/school/transport';
import { SchoolLibraryPage } from '@/pages/school/library';
import { FrontDeskPage } from '@/pages/school/front-desk';
import { SchoolReportCardsPage } from '@/pages/school/report-cards';
import { SchoolReportCardSettingsPage } from '@/pages/school/report-card-settings';
import { SchoolPromotionPage } from '@/pages/school/promotion';
import { SchoolMessagingPage } from '@/pages/school/messaging';
import { SchoolMealsPage } from '@/pages/school/meals';
import { SchoolAdmissionsPage } from '@/pages/school/admissions';
import { SchoolEnrollmentSummaryPage } from '@/pages/school/enrollment-summary';
import { SchoolApplicationsPage } from '@/pages/school/applications';
import { SchoolApplicationFormPage } from '@/pages/school/application-form';
import { SchoolAdmissionsAnalyticsPage } from '@/pages/school/admissions-analytics';
import { SchoolAdmissionsConfigPage } from '@/pages/school/admissions-config';
import { SchoolAdmissionsWorkflowPage } from '@/pages/school/admissions-workflow';
import { SchoolApplyTrackPage } from '@/pages/school/apply-track';
import { SchoolStaffPage } from '@/pages/school/staff';
import { SchoolCampusesPage } from '@/pages/school/campuses';
import { SchoolSubjectsPage } from '@/pages/school/subjects';
import { SchoolAssessmentPage } from '@/pages/school/assessment';
import { SchoolAssessmentsPage } from '@/pages/school/assessments';
import { SchoolAssessmentMarkPage } from '@/pages/school/assessment-mark';
import { SchoolApprovalsPage } from '@/pages/school/approvals';
import { SchoolExamWorkspacePage } from '@/pages/school/exam-workspace';
import { SchoolExamClassesPage } from '@/pages/school/exam-classes';
import { SchoolEnterMarksPage } from '@/pages/school/enter-marks';
import { SchoolExamResultsPage } from '@/pages/school/exam-results';
import { SchoolGradebookPage } from '@/pages/school/gradebook';
import { SchoolTeachingPage } from '@/pages/school/teaching';
import { SchoolHomeworkPage } from '@/pages/school/homework';
import { SchoolAssessmentOpsPage } from '@/pages/school/assessment-ops';
import { SchoolResultsPage } from '@/pages/school/results';
import { SchoolGradingScalePage } from '@/pages/school/grading-scales';
import { SchoolExamOpsPage } from '@/pages/school/exam-ops';
import { SchoolCbtPage } from '@/pages/school/cbt';
import { SchoolCertificationPage } from '@/pages/school/certification';
import SchoolDocumentsPage from '@/pages/school/documents';
import { SchoolLearningOutcomesPage } from '@/pages/school/learning-outcomes';
import { SchoolCompetencyReportPage } from '@/pages/school/competency-report';
import { SchoolAnalyticsPage } from '@/pages/school/analytics';
import { SchoolPortalsPage } from '@/pages/school/portals';
import { SchoolAcademicYearsPage } from '@/pages/school/academic-years';
import { SchoolTermsPage } from '@/pages/school/terms';
import { SchoolDepartmentsPage } from '@/pages/school/departments';
import { SchoolClassesPage } from '@/pages/school/classes';
import { SchoolSectionsPage } from '@/pages/school/sections';
import { SchoolStreamsPage } from '@/pages/school/streams';
import { SchoolSubjectsAdminPage } from '@/pages/school/subjects-admin';
import { SchoolCurriculaPage } from '@/pages/school/curricula';
import { SchoolTeachingLoadPage } from '@/pages/school/teaching-load';
import { SchoolCalendarPage } from '@/pages/school/calendar';
import { SchoolEventsPage } from '@/pages/school/events';
import { SchoolPoliciesPage } from '@/pages/school/policies';
import { SchoolCustomFieldsPage } from '@/pages/school/custom-fields';
import { SchoolRolesPage } from '@/pages/school/roles';
import { SchoolLmsCourseOfferingsPage } from '@/pages/school/lms/course-offerings';
import { SchoolLmsLessonPlansPage } from '@/pages/school/lms/lesson-plans';
import { SchoolLmsTemplatesPage } from '@/pages/school/lms/templates';
import { SchoolLmsScheduledLessonsPage } from '@/pages/school/lms/scheduled-lessons';
import { SchoolLmsDiscussionsPage } from '@/pages/school/lms/discussions';
import { SchoolLmsMasteryPage } from '@/pages/school/lms/mastery';
import { SchoolLmsCoveragePage } from '@/pages/school/lms/coverage';
import { SchoolLmsCoursesPage } from '@/pages/school/lms/courses';
import { SchoolLmsCoursePage } from '@/pages/school/lms/course-page';
import { SchoolLmsModuleViewPage } from '@/pages/school/lms/module-view';
import { SchoolLmsParticipantsPage } from '@/pages/school/lms/participants';
import { DealsPage } from '@/pages/crm/deals';
import { DealDetailPage } from '@/pages/crm/deal-detail';
import { BackupPage } from '@/pages/settings/BackupPage';
import { AssetDashboardPage } from '@/pages/fixed-asset/AssetDashboardPage';
import { AssetCategoriesPage } from '@/pages/fixed-asset/AssetCategoriesPage';
import { AssetsPage } from '@/pages/fixed-asset/AssetsPage';
import { AssetDetailPage } from '@/pages/fixed-asset/AssetDetailPage';
import { ProductionDashboardPage } from '@/pages/manufacturing/ProductionDashboardPage';
import { BomsPage } from '@/pages/manufacturing/BomsPage';
import { ProductionOrdersPage } from '@/pages/manufacturing/ProductionOrdersPage';
import { ProductionOrderDetailPage } from '@/pages/manufacturing/ProductionOrderDetailPage';
import { ManufacturingPlanningPage } from '@/pages/manufacturing/ManufacturingPlanningPage';
import { ManufacturingReportsPage } from '@/pages/manufacturing/ManufacturingReportsPage';
import { ManufacturingResourcesPage } from '@/pages/manufacturing/ManufacturingResourcesPage';
import { ChartOfAccountsPage } from '@/pages/accounting/chart-of-accounts';
import { AccountDetailPage } from '@/pages/accounting/AccountDetailPage';
import { CashAccountsPage } from '@/pages/accounting/cash-accounts';
import { CashAccountDetailPage } from '@/pages/accounting/cash-account-detail';
import { CashRegistersCrudPage } from '@/pages/accounting/cash-registers';
import { AccountMappingsPage } from '@/pages/accounting/account-mappings';
import { AccountCategoriesPage } from '@/pages/accounting/account-categories';
import { JournalEntriesPage } from '@/pages/accounting/journal-entries';
import { GeneralLedgerPage } from '@/pages/accounting/general-ledger';
import { ProfitAndLossPage } from '@/pages/accounting/profit-and-loss';
import { CashFlowPage } from '@/pages/accounting/cash-flow';
import { AccountLedgerPage } from '@/pages/accounting/account-ledger';
import { TieOutPage } from '@/pages/accounting/tieout';
import { AuditLogPage } from '@/pages/accounting/audit-log';
import FiscalPeriodsPage from '@/pages/accounting/fiscal-periods';
import TaxesPage from '@/pages/accounting/taxes';
import PaymentTermsPage from '@/pages/accounting/payment-terms';
import FiscalPositionsPage from '@/pages/accounting/fiscal-positions';
import { CostCentersPage } from '@/pages/accounting/cost-centers';
import { CurrencyPage } from '@/pages/accounting/currency';
import { InventoryValuationPage } from '@/pages/accounting/inventory-valuation';
import { YearEndClosePage } from '@/pages/accounting/year-end-close';
import { TrialBalancePage } from '@/pages/accounting/trial-balance';
import { BalanceSheetPage } from '@/pages/accounting/balance-sheet';
import { InvoicesPage } from '@/pages/invoicing/invoices';
import { InvoiceCreatePage } from '@/pages/invoicing/invoice-create';
import { InvoiceDetailPage } from '@/pages/invoicing/invoice-detail';
import { OrdersPage } from '@/pages/orders/orders';
import CommunicationInboxPage from '@/pages/communication/inbox';
import CommunicationRulesPage from '@/pages/communication/rules';
import CommunicationChannelsPage from '@/pages/communication/channels';
import { OrderCreatePage } from '@/pages/orders/order-create';
import { OrderDetailPage } from '@/pages/orders/order-detail';
import { ArAgingPage } from '@/pages/invoicing/ar-aging';
import { CreditNotesPage } from '@/pages/invoicing/credit-notes';
import { CreditNoteCreatePage } from '@/pages/invoicing/credit-note-create';
import { CreditNoteDetailPage } from '@/pages/invoicing/credit-note-detail';
import { PaymentsPage } from '@/pages/invoicing/payments';
import { PaymentDetailPage } from '@/pages/invoicing/payment-detail';
import { ReceiptsPage } from '@/pages/pos/ReceiptsPage';
import { ReceiptDetailPage } from '@/pages/pos/ReceiptDetailPage';
import { ReceivablesPage } from '@/pages/pos/ReceivablesPage';
import { ExpensesPage } from '@/pages/expenses/ExpensesPage';
import ExpensesReportPage from '@/pages/expenses/ExpensesReportPage';
import ExpenseCategoriesPage from '@/pages/expenses/ExpenseCategoriesPage';
import { SupplierPaymentsPage } from '@/pages/purchasing/supplier-payments';
import { JournalsPage } from '@/pages/accounting/journals';
import { JournalDetailPage } from '@/pages/accounting/JournalDetailPage';
import { JournalEditPage } from '@/pages/accounting/JournalEditPage';
import { JournalEntryCreatePage } from '@/pages/accounting/journal-entry-create';
import { JournalEntryDetailPage } from '@/pages/accounting/journal-entry-detail';
import { InventoryPostingRulesPage } from '@/pages/accounting/inventory-posting-rules';
import { ProductEditPage } from '@/pages/products/ProductEditPage';
import { PurchaseRequestsPage } from '@/pages/procurement/purchase-requests';
import { PurchaseOrdersPage } from '@/pages/procurement/purchase-orders';
import { PurchaseOrderCreatePage } from '@/pages/procurement/purchase-order-create';
import { PurchaseOrderDetailPage } from '@/pages/procurement/PurchaseOrderDetailPage';
import { PurchaseOrderReceivePage } from '@/pages/procurement/PurchaseOrderReceivePage';
import { PurchaseOrderPayPage } from '@/pages/procurement/PurchaseOrderPayPage';
import { GoodsReceiptsPage } from '@/pages/procurement/goods-receipts';
import { GoodsReceiptCreatePage } from '@/pages/procurement/goods-receipt-create';
import GoodsReceiptDetailPage from '@/pages/procurement/goods-receipt-detail';
import { ThreeWayMatchPage } from '@/pages/procurement/three-way-match';
import { DebitNotesPage } from '@/pages/procurement/debit-notes';
import { DebitNoteCreatePage } from '@/pages/procurement/debit-note-create';
import { InventoryItemsPage } from '@/pages/inventory/InventoryItemsPage';
import InventoryDetailPage from '@/pages/inventory/InventoryDetailPage';
import { StockAdjustmentsPage } from '@/pages/inventory/StockAdjustmentsPage';
import { StockTransfersPage } from '@/pages/inventory/StockTransfersPage';
import { InventoryCountPage } from '@/pages/inventory/InventoryCountPage';
import { BottleCountPage } from '@/pages/beverage/BottleCountPage';
import { BeverageDashboardPage } from '@/pages/beverage/BeverageDashboardPage';
import { RentalDashboardPage } from '@/pages/rental/RentalDashboardPage';
import { RentalAgreementsPage } from '@/pages/rental/RentalAgreementsPage';
import { RentalAgreementCreatePage } from '@/pages/rental/RentalAgreementCreatePage';
import { RentalAgreementDetailPage } from '@/pages/rental/RentalAgreementDetailPage';
import { RentalUnitsPage } from '@/pages/rental/RentalUnitsPage';
import { RentalCatalogPage } from '@/pages/rental/RentalCatalogPage';
import { RentalReturnsPage } from '@/pages/rental/RentalReturnsPage';
import { RentalReportsPage } from '@/pages/rental/RentalReportsPage';
import { RepairDashboardPage } from '@/pages/repair/RepairDashboardPage';
import { RepairOrdersPage } from '@/pages/repair/RepairOrdersPage';
import { RepairOrderCreatePage } from '@/pages/repair/RepairOrderCreatePage';
import { RepairOrderDetailPage } from '@/pages/repair/RepairOrderDetailPage';
import { RepairTechniciansPage } from '@/pages/repair/RepairTechniciansPage';
import { RepairLabourPage } from '@/pages/repair/RepairLabourPage';
import { RepairJobsPage } from '@/pages/repair/RepairJobsPage';
import { RepairWarrantiesPage } from '@/pages/repair/RepairWarrantiesPage';
import { RepairContractsPage } from '@/pages/repair/RepairContractsPage';
import { RepairReportsPage } from '@/pages/repair/RepairReportsPage';
import { HrDashboardPage } from '@/pages/hr/HrDashboardPage';
import { HrEmployeesPage } from '@/pages/hr/HrEmployeesPage';
import { HrEmployeeDetailPage } from '@/pages/hr/HrEmployeeDetailPage';
import { HrDepartmentsPage } from '@/pages/hr/HrDepartmentsPage';
import { HrPositionsPage } from '@/pages/hr/HrPositionsPage';
import { HrShiftsPage } from '@/pages/hr/HrShiftsPage';
import { HrAttendancePage } from '@/pages/hr/HrAttendancePage';
import { HrTimesheetsPage } from '@/pages/hr/HrTimesheetsPage';
import { HrLeavePage } from '@/pages/hr/HrLeavePage';
import { HrHolidaysPage } from '@/pages/hr/HrHolidaysPage';
import { HrPayrollPage } from '@/pages/hr/HrPayrollPage';
import { HrPayrollSettingsPage } from '@/pages/hr/HrPayrollSettingsPage';
import { HrPayslipsPage } from '@/pages/hr/HrPayslipsPage';
import { HrAdvancesLoansPage } from '@/pages/hr/HrAdvancesLoansPage';
import { HrReportsPage } from '@/pages/hr/HrReportsPage';
import { HrJobGradesPage } from '@/pages/hr/HrJobGradesPage';
import { HrContractsPage } from '@/pages/hr/HrContractsPage';
import { HrRecruitmentPage } from '@/pages/hr/HrRecruitmentPage';
import { HrQualificationsPage } from '@/pages/hr/HrQualificationsPage';
import { HrTrainingPage } from '@/pages/hr/HrTrainingPage';
import { HrOffboardingPage } from '@/pages/hr/HrOffboardingPage';
import { HrPayrollPreviewPage } from '@/pages/hr/HrPayrollPreviewPage';
import { HrMyPage } from '@/pages/hr/HrMyPage';
import { StockLedgerPage } from '@/pages/inventory/StockLedgerPage';
import LocationsPage from '@/pages/inventory/LocationsPage';
import TerminalPage from '@/pages/pos/Terminal';
import ReportsPage from '@/pages/pos/ReportsPage';
import DisplayPage from '@/pages/pos/DisplayPage';
import KdsPage from '@/pages/pos/KdsPage';
import KitchenStationsPage from '@/pages/pos/KitchenStationsPage';
import KdsReportsPage from '@/pages/pos/KdsReportsPage';
import CashRegistersPage from '@/pages/pos/cash/CashRegistersPage';
import DigitalMenuPage from '@/pages/pos/DigitalMenuPage';
import TablesPage from '@/pages/tables/TablesPage';
import ReservationsPage from '@/pages/tables/ReservationsPage';
import TableReportsPage from '@/pages/tables/TableReportsPage';
import ReportCenterPage from '@/pages/reports/ReportCenterPage';
import { StaffPage } from '@/pages/staff/StaffPage';
import { RolesPage } from '@/pages/staff/RolesPage';
import { RoleEditPage } from '@/pages/staff/RoleEditPage';
import { TasksPage } from '@/pages/tasks/TasksPage';
import { TaskEditPage } from '@/pages/tasks/TaskEditPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Digital Menu — customer-facing public route (no auth, no shell). */}
      <Route path="/menu/:branchId/:tableId" element={<DigitalMenuPage />} />
      {/* Applicant portal — magic-link tracking page (no auth, no shell). */}
      <Route path="/apply/track" element={<SchoolApplyTrackPage />} />
      <Route element={<ProtectedRoute />}>
        {/* KDS — full-screen kitchen monitor, chrome-less (no sidebar/header). */}
        <Route path="/pos/kds" element={<KdsPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          {/* POS terminal — full-screen cashier UI. Renders outside the app shell. */}
          <Route path="/pos/terminal" element={<TerminalPage />} />
          <Route path="/pos/reports" element={<ReportsPage />} />
          {/* POS customer display — second monitor / pole display, no shell. */}
          <Route path="/pos/display" element={<DisplayPage />} />
          {/* KDS station configuration (admin, inside the shell). */}
          <Route path="/pos/kitchen-stations" element={<KitchenStationsPage />} />
          {/* KDS kitchen performance reports + live dashboard. */}
          <Route path="/pos/kds-reports" element={<KdsReportsPage />} />
          {/* POS Cash Register Management */}
          <Route path="/pos/cash-registers" element={<CashRegistersPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/tables/reservations" element={<ReservationsPage />} />
          <Route path="/tables/reports" element={<TableReportsPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/staff/roles" element={<RolesPage />} />
          <Route path="/staff/roles/:id/edit" element={<RoleEditPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:partnerId" element={<CustomerDetailPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/suppliers/:partnerId" element={<SupplierDetailPage />} />
          <Route path="/suppliers/:partnerId/ledger" element={<SupplierLedgerPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductEditPage />} />
          <Route path="/products/:id/edit" element={<ProductEditPage />} />
          <Route path="/uom" element={<UomPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/menu/:menuItemId" element={<MenuDetailPage />} />
          <Route path="/menu/modifiers" element={<ModifiersPage />} />
          <Route path="/menu/combos" element={<ComboListPage />} />
          <Route path="/menu/accompaniments" element={<AccompanimentGroupsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
                    <Route path="/invoices/new" element={<InvoiceCreatePage />} />
                    <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="/orders" element={<OrdersPage />} />
                    <Route path="/orders/new" element={<OrderCreatePage />} />
                    <Route path="/orders/:id" element={<OrderDetailPage />} />
                    <Route path="/communication" element={<CommunicationInboxPage />} />
                    <Route path="/communication/rules" element={<CommunicationRulesPage />} />
                    <Route path="/communication/channels" element={<CommunicationChannelsPage />} />
          <Route path="/credit-notes" element={<CreditNotesPage />} />
          <Route path="/credit-notes/new" element={<CreditNoteCreatePage />} />
          <Route path="/credit-notes/:id" element={<CreditNoteDetailPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/payments/:id" element={<PaymentDetailPage />} />
          <Route path="/pos/receipts" element={<ReceiptsPage />} />
          <Route path="/pos/receipts/:invoiceId" element={<ReceiptDetailPage />} />
          {/* Sales charged to a customer's account, awaiting payment. */}
          <Route path="/pos/receivables" element={<ReceivablesPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/expenses/categories" element={<ExpenseCategoriesPage />} />
          <Route path="/expenses/reports" element={<ExpensesReportPage />} />
          <Route path="/supplier-payments" element={<SupplierPaymentsPage />} />
          <Route path="/ar-aging" element={<ArAgingPage />} />
          <Route path="/accounts" element={<ChartOfAccountsPage />} />
          <Route path="/accounts/new" element={<AccountDetailPage />} />
          {/* Static segments must stay ahead of /accounts/:id. */}
          <Route path="/accounts/categories" element={<AccountCategoriesPage />} />
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
          <Route path="/accounts/cash-accounts" element={<CashAccountsPage />} />
          <Route path="/accounts/cash-accounts/:id" element={<CashAccountDetailPage />} />
          <Route path="/accounts/cash-registers" element={<CashRegistersCrudPage />} />
          <Route path="/accounts/mappings" element={<AccountMappingsPage />} />
          <Route path="/accounts/posting-rules" element={<InventoryPostingRulesPage />} />
          <Route path="/journals" element={<JournalsPage />} />
          <Route path="/journals/new" element={<JournalEditPage />} />
          <Route path="/journals/:id" element={<JournalDetailPage />} />
          <Route path="/journals/:id/edit" element={<JournalEditPage />} />
          <Route path="/journal-entries" element={<JournalEntriesPage />} />
          <Route path="/journal-entries/new" element={<JournalEntryCreatePage />} />
          <Route path="/journal-entries/:id" element={<JournalEntryDetailPage />} />
          <Route path="/trial-balance" element={<TrialBalancePage />} />
          <Route path="/general-ledger" element={<GeneralLedgerPage />} />
          <Route path="/profit-and-loss" element={<ProfitAndLossPage />} />
          <Route path="/cash-flow" element={<CashFlowPage />} />
          <Route path="/accounts/ledger/:id" element={<AccountLedgerPage />} />
          <Route path="/tieout" element={<TieOutPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/fiscal-periods" element={<FiscalPeriodsPage />} />
          <Route path="/taxes" element={<TaxesPage />} />
          <Route path="/accounts/payment-terms" element={<PaymentTermsPage />} />
          <Route path="/accounts/fiscal-positions" element={<FiscalPositionsPage />} />
          <Route path="/cost-centers" element={<CostCentersPage />} />
          <Route path="/currency" element={<CurrencyPage />} />
          <Route path="/inventory-valuation" element={<InventoryValuationPage />} />
          <Route path="/year-end-close" element={<YearEndClosePage />} />
          <Route path="/balance-sheet" element={<BalanceSheetPage />} />
          <Route path="/reports" element={<ReportCenterPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/approval-workflows" element={<ApprovalWorkflowsPage />} />
          <Route path="/approval-policies" element={<ApprovalPoliciesPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/developer" element={<DevCompanySettingsPage />} />
          <Route path="/settings/company" element={<CompanySettingsPage />} />
          <Route path="/settings/receipt" element={<ReceiptSettingsPage />} />
          <Route path="/settings/backup" element={<BackupPage />} />
          <Route path="/settings/devices" element={<DevicesPage />} />
          <Route path="/settings/devices/rejected" element={<DeadLettersPage />} />
          <Route path="/inventory/posting-monitor" element={<PostingMonitorPage />} />
          <Route path="/fixed-assets" element={<AssetDashboardPage />} />
          <Route path="/fixed-assets/categories" element={<AssetCategoriesPage />} />
          <Route path="/fixed-assets/register" element={<AssetsPage />} />
          <Route path="/fixed-assets/:id" element={<AssetDetailPage />} />
          {/* Manufacturing — static segments before the :id route */}
          <Route path="/manufacturing" element={<ProductionDashboardPage />} />
          <Route path="/manufacturing/boms" element={<BomsPage />} />
          <Route path="/manufacturing/planning" element={<ManufacturingPlanningPage />} />
          <Route path="/manufacturing/reports" element={<ManufacturingReportsPage />} />
          <Route path="/manufacturing/resources" element={<ManufacturingResourcesPage />} />
          <Route path="/manufacturing/orders" element={<ProductionOrdersPage />} />
          <Route path="/manufacturing/orders/:id" element={<ProductionOrderDetailPage />} />
          <Route path="/inventory" element={<InventoryItemsPage />} />
          <Route path="/inventory/items" element={<InventoryItemsPage />} />
          <Route path="/inventory/items/:productId" element={<InventoryDetailPage />} />
          <Route path="/inventory/adjustments" element={<StockAdjustmentsPage />} />
          <Route path="/inventory/transfers" element={<StockTransfersPage />} />
          <Route path="/inventory/count" element={<InventoryCountPage />} />
          <Route path="/beverage" element={<BeverageDashboardPage />} />
          <Route path="/beverage/count" element={<BottleCountPage />} />
          {/* Rental — static segments before /rental/agreements/:id */}
          <Route path="/rental" element={<RentalDashboardPage />} />
          <Route path="/rental/agreements" element={<RentalAgreementsPage />} />
          <Route path="/rental/agreements/new" element={<RentalAgreementCreatePage />} />
          <Route path="/rental/agreements/:id" element={<RentalAgreementDetailPage />} />
          <Route path="/rental/units" element={<RentalUnitsPage />} />
          <Route path="/rental/catalog" element={<RentalCatalogPage />} />
          <Route path="/rental/returns" element={<RentalReturnsPage />} />
          <Route path="/rental/reports" element={<RentalReportsPage />} />
          {/* Repair & Maintenance — static segments before /repair/orders/:id */}
          <Route path="/repair" element={<RepairDashboardPage />} />
          <Route path="/repair/orders" element={<RepairOrdersPage />} />
          <Route path="/repair/orders/new" element={<RepairOrderCreatePage />} />
          <Route path="/repair/orders/:id" element={<RepairOrderDetailPage />} />
          <Route path="/repair/jobs" element={<RepairJobsPage />} />
          <Route path="/repair/technicians" element={<RepairTechniciansPage />} />
          <Route path="/repair/labour" element={<RepairLabourPage />} />
          <Route path="/repair/warranties" element={<RepairWarrantiesPage />} />
          <Route path="/repair/contracts" element={<RepairContractsPage />} />
          <Route path="/repair/reports" element={<RepairReportsPage />} />

          {/* Workforce Management (HR) — static segments before /hr/employees/:id */}
          <Route path="/hr" element={<HrDashboardPage />} />
          <Route path="/hr/employees" element={<HrEmployeesPage />} />
          <Route path="/hr/employees/:id" element={<HrEmployeeDetailPage />} />
          <Route path="/hr/departments" element={<HrDepartmentsPage />} />
          <Route path="/hr/positions" element={<HrPositionsPage />} />
          <Route path="/hr/shifts" element={<HrShiftsPage />} />
          <Route path="/hr/attendance" element={<HrAttendancePage />} />
          <Route path="/hr/timesheets" element={<HrTimesheetsPage />} />
          <Route path="/hr/leave" element={<HrLeavePage />} />
          <Route path="/hr/holidays" element={<HrHolidaysPage />} />
          <Route path="/hr/payroll" element={<HrPayrollPage />} />
          <Route path="/hr/payroll/runs/:id" element={<HrPayrollPage />} />
          <Route path="/hr/payroll/settings" element={<HrPayrollSettingsPage />} />
          <Route path="/hr/payslips" element={<HrPayslipsPage />} />
          <Route path="/hr/advances-loans" element={<HrAdvancesLoansPage />} />
          <Route path="/hr/reports" element={<HrReportsPage />} />
          <Route path="/hr/job-grades" element={<HrJobGradesPage />} />
          <Route path="/hr/contracts" element={<HrContractsPage />} />
          <Route path="/hr/recruitment" element={<HrRecruitmentPage />} />
          <Route path="/hr/qualifications" element={<HrQualificationsPage />} />
          <Route path="/hr/training" element={<HrTrainingPage />} />
          <Route path="/hr/offboarding" element={<HrOffboardingPage />} />
          <Route path="/hr/payroll/preview" element={<HrPayrollPreviewPage />} />
          <Route path="/hr/my" element={<HrMyPage />} />
          <Route path="/inventory/ledger" element={<StockLedgerPage />} />
          <Route path="/inventory/locations" element={<LocationsPage />} />
          <Route path="/procurement/purchase-requests" element={<PurchaseRequestsPage />} />
          <Route path="/procurement/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/procurement/purchase-orders/new" element={<PurchaseOrderCreatePage />} />
          <Route path="/procurement/purchase-orders/:id/receive" element={<PurchaseOrderReceivePage />} />
          <Route path="/procurement/purchase-orders/:id/pay" element={<PurchaseOrderPayPage />} />
          <Route path="/procurement/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          <Route path="/procurement/goods-receipts" element={<GoodsReceiptsPage />} />
          <Route path="/procurement/goods-receipts/new" element={<GoodsReceiptCreatePage />} />
          <Route path="/procurement/goods-receipts/:id" element={<GoodsReceiptDetailPage />} />
          <Route path="/procurement/three-way-match" element={<ThreeWayMatchPage />} />
          <Route path="/procurement/debit-notes" element={<DebitNotesPage />} />
          <Route path="/procurement/debit-notes/new" element={<DebitNoteCreatePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/new" element={<TaskEditPage />} />
          <Route path="/tasks/:id/edit" element={<TaskEditPage />} />
          {/* CRM — static segments before /crm/deals/:id */}
          <Route path="/crm" element={<CrmDashboardPage />} />
          <Route path="/school" element={<SchoolDashboardPage />} />
          <Route path="/school/students" element={<SchoolStudentsPage />} />
          <Route path="/school/students/:id" element={<SchoolStudent360Page />} />
          <Route path="/school/fees" element={<SchoolFeesPage />} />
          <Route path="/school/fees/categories" element={<SchoolFeeCategoriesPage />} />
          <Route path="/school/fees/structures" element={<SchoolFeeStructuresPage />} />
          <Route path="/school/fees/optional" element={<SchoolOptionalFeesPage />} />
          <Route path="/school/fees/schedules" element={<SchoolFeeSchedulesPage />} />
          <Route path="/school/fees/collect" element={<SchoolFeesCollectPage />} />
          <Route path="/school/fees/waiver-categories" element={<SchoolWaiverCategoriesPage />} />
          <Route path="/school/fees/waivers" element={<SchoolWaiversPage />} />
          <Route path="/school/fees/defaulters" element={<SchoolFeeDefaultersPage />} />
          <Route path="/school/fees/bad-debtors" element={<SchoolBadDebtorsPage />} />
          <Route path="/school/fees/budgeting" element={<SchoolBudgetingPage />} />
          <Route path="/school/fees/receipts" element={<SchoolReceiptsPage />} />
          <Route path="/school/fees/bulk-collect" element={<SchoolBulkCollectPage />} />
          <Route path="/school/fees/clearance" element={<SchoolFeeClearancePage />} />
          <Route path="/school/fees/statement" element={<SchoolFeeStatementPage />} />
          <Route path="/school/fees/cash-book" element={<SchoolCashBookPage />} />
          <Route path="/school/fees/discounts" element={<SchoolDiscountsPage />} />
          <Route path="/school/fees/overrides" element={<SchoolFeeOverridesPage />} />
          <Route path="/school/fees/mobile-money" element={<SchoolMobileMoneyPage />} />
          <Route path="/school/fees/explain" element={<SchoolBalanceExplainerPage />} />
          <Route path="/school/fees/dashboard" element={<SchoolFinanceDashboardPage />} />
          <Route path="/school/fees/invoices" element={<SchoolInvoicesPage />} />
          <Route path="/school/fees/billing-runs" element={<SchoolBillingRunsPage />} />
          <Route path="/school/fees/adjustments" element={<SchoolAdjustmentsPage />} />
          <Route path="/school/fees/reconciliation" element={<SchoolReconciliationPage />} />
          <Route path="/school/students/:id/ledger" element={<SchoolStudentLedgerPage />} />
          <Route path="/school/fees/ledger" element={<SchoolStudentLedgerPage />} />
          <Route path="/school/attendance" element={<SchoolAttendancePage />} />
          <Route path="/school/attendance/statuses" element={<SchoolAttendanceStatusesPage />} />
          <Route path="/school/attendance/report" element={<SchoolAttendanceReportPage />} />
          <Route path="/school/timetable" element={<SchoolTimetablePage />} />
          {/* P6: the classic exam page is superseded by the numbered workspace. */}
          <Route path="/school/exams" element={<Navigate to="/school/exam-workspace" replace />} />
          <Route path="/school/report-cards" element={<SchoolReportCardsPage />} />
          <Route path="/school/report-card-settings" element={<SchoolReportCardSettingsPage />} />
          <Route path="/school/promotion" element={<SchoolPromotionPage />} />
          <Route path="/school/messaging" element={<SchoolMessagingPage />} />
          <Route path="/school/meals" element={<SchoolMealsPage />} />
          <Route path="/school/admissions" element={<SchoolAdmissionsPage />} />
          <Route path="/school/admissions/analytics" element={<SchoolAdmissionsAnalyticsPage />} />
          <Route path="/school/admissions/config" element={<SchoolAdmissionsConfigPage />} />
          <Route path="/school/admissions/workflow" element={<SchoolAdmissionsWorkflowPage />} />
          <Route path="/school/admissions/enrollment-summary" element={<SchoolEnrollmentSummaryPage />} />
          <Route path="/school/applications/new" element={<SchoolApplicationFormPage />} />
          <Route path="/school/applications/:id" element={<SchoolApplicationFormPage />} />
          <Route path="/school/applications" element={<SchoolApplicationsPage />} />
          <Route path="/school/staff" element={<SchoolStaffPage />} />
          <Route path="/school/campuses" element={<SchoolCampusesPage />} />
          <Route path="/school/subjects" element={<SchoolSubjectsPage />} />
          <Route path="/school/management/academic-years" element={<SchoolAcademicYearsPage />} />
          <Route path="/school/management/terms" element={<SchoolTermsPage />} />
          <Route path="/school/management/departments" element={<SchoolDepartmentsPage />} />
          <Route path="/school/management/classes" element={<SchoolClassesPage />} />
          <Route path="/school/management/sections" element={<SchoolSectionsPage />} />
          <Route path="/school/management/streams" element={<SchoolStreamsPage />} />
          <Route path="/school/management/subjects" element={<SchoolSubjectsAdminPage />} />
          <Route path="/school/curricula" element={<SchoolCurriculaPage />} />
          <Route path="/school/teaching-load" element={<SchoolTeachingLoadPage />} />
          <Route path="/school/management/calendar" element={<Navigate to="/school/timetable/calendar" replace />} />
          <Route path="/school/timetable/calendar" element={<SchoolCalendarPage />} />
          <Route path="/school/timetable/events" element={<SchoolEventsPage />} />
          <Route path="/school/timetable/trips" element={<SchoolTripsPage />} />
          <Route path="/school/transport" element={<SchoolTransportPage />} />
          <Route path="/school/library" element={<SchoolLibraryPage />} />
          <Route path="/school/front-desk" element={<FrontDeskPage />} />
          <Route path="/school/management/policies" element={<SchoolPoliciesPage />} />
          <Route path="/school/management/custom-fields" element={<SchoolCustomFieldsPage />} />
          <Route path="/school/management/roles" element={<SchoolRolesPage />} />
          <Route path="/school/exam-workspace" element={<SchoolExamWorkspacePage />} />
          <Route path="/school/exam-workspace/classes" element={<SchoolExamClassesPage />} />
          <Route path="/school/enter-marks" element={<SchoolEnterMarksPage />} />
          <Route path="/school/exam-results" element={<SchoolExamResultsPage />} />
          <Route path="/school/gradebook" element={<SchoolGradebookPage />} />
          <Route path="/school/teaching" element={<SchoolTeachingPage />} />
          {/* The unified front door: every kind of assessment in one list, and
              one marking screen behind it. Homework and the numbered exam steps
              are filters/views of this, not separate systems. */}
          <Route path="/school/assessments" element={<SchoolAssessmentsPage />} />
          <Route path="/school/assessments/:assessmentId/mark" element={<SchoolAssessmentMarkPage />} />
          <Route path="/school/approvals" element={<SchoolApprovalsPage />} />
          {/* Homework keeps its own screen: it collects and returns SUBMISSIONS,
              which the assessment board does not model. The board links into it. */}
          <Route path="/school/homework" element={<SchoolHomeworkPage />} />
          <Route path="/school/assessment" element={<SchoolAssessmentPage />} />
          {/* P6: My Marking → the teacher workspace, which finds the work for you. */}
          <Route path="/school/my-marking" element={<Navigate to="/school/teaching" replace />} />
          {/* One marking screen. The old per-assessment marksheet kept its own
              copy of the grid; the route survives so bookmarks still land. */}
          <Route path="/school/marksheet/:assessmentId" element={<SchoolAssessmentMarkPage />} />
          <Route path="/school/assessment-ops" element={<SchoolAssessmentOpsPage />} />
          <Route path="/school/results" element={<SchoolResultsPage />} />
          <Route path="/school/grading-scales" element={<SchoolGradingScalePage />} />
          <Route path="/school/exam-ops" element={<SchoolExamOpsPage />} />
          <Route path="/school/learning-outcomes" element={<SchoolLearningOutcomesPage />} />
          <Route path="/school/competency-report" element={<SchoolCompetencyReportPage />} />
          <Route path="/school/lms/courses" element={<SchoolLmsCoursesPage />} />
          <Route path="/school/lms/courses/:id" element={<SchoolLmsCoursePage />} />
          <Route path="/school/lms/courses/:id/participants" element={<SchoolLmsParticipantsPage />} />
          <Route path="/school/lms/modules/:id" element={<SchoolLmsModuleViewPage />} />
          <Route path="/school/lms/course-offerings" element={<SchoolLmsCourseOfferingsPage />} />
          <Route path="/school/lms/lesson-plans" element={<SchoolLmsLessonPlansPage />} />
          <Route path="/school/lms/templates" element={<SchoolLmsTemplatesPage />} />
          <Route path="/school/lms/scheduled-lessons" element={<SchoolLmsScheduledLessonsPage />} />
          <Route path="/school/lms/discussions" element={<SchoolLmsDiscussionsPage />} />
          {/* P6: the LMS debug homework form and teacher dashboard are consolidated. */}
          <Route path="/school/lms/homework" element={<Navigate to="/school/homework" replace />} />
          <Route path="/school/lms/teacher-dashboard" element={<Navigate to="/school/teaching" replace />} />
          <Route path="/school/lms/mastery" element={<SchoolLmsMasteryPage />} />
          <Route path="/school/lms/coverage" element={<SchoolLmsCoveragePage />} />
          <Route path="/school/cbt" element={<SchoolCbtPage />} />
          <Route path="/school/certification" element={<SchoolCertificationPage />} />
          <Route path="/school/documents" element={<SchoolDocumentsPage />} />
          <Route path="/school/analytics" element={<SchoolAnalyticsPage />} />
          <Route path="/school/portals" element={<SchoolPortalsPage />} />
          <Route path="/crm/deals" element={<DealsPage />} />
          <Route path="/crm/deals/:id" element={<DealDetailPage />} />

                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
  );
}
