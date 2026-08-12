import { useEffect, useState, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Edit,
  Eye,
  Plus,
  Search,
  Trash2,
  Building2,
  User,
  Users,
  Briefcase,
  Mail,
  Phone,
  Code2,
  Tag,
  X,
  Check,
  MapPin,
  FileText,
  Award,
} from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigate } from 'react-router-dom';
import {
  useCreatePartner,
  useDeletePartner,
  useLoyaltyEarned,
  usePartners,
  useUpdatePartner,
  type Partner,
} from '@/features/partners/api';

const schema = z.object({
  code: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')).transform(v => v || undefined),
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  isEmployee: z.boolean().optional(),
});
type FormValues = z.infer<typeof schema>;

export type PartnerTypeFilter = 'customer' | 'supplier';

const ALL_PARTNER_TYPES = [
  { key: 'isCustomer' as const, label: 'Customer', icon: Users, description: 'Buy products or services' },
  { key: 'isSupplier' as const, label: 'Supplier', icon: Building2, description: 'Provide products or services' },
  { key: 'isEmployee' as const, label: 'Employee', icon: Briefcase, description: 'Staff member' },
];

const TYPE_CFG: Record<PartnerTypeFilter, { key: 'isCustomer' | 'isSupplier'; label: string; labelPlural: string; icon: typeof Users; badgeCls: string; placeholder: string }> = {
  customer: {
    key: 'isCustomer',
    label: 'Customer',
    labelPlural: 'Customers',
    icon: Users,
    badgeCls: 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-none',
    placeholder: 'Search customers by name, code, or email...',
  },
  supplier: {
    key: 'isSupplier',
    label: 'Supplier',
    labelPlural: 'Suppliers',
    icon: Building2,
    badgeCls: 'bg-purple-100 text-purple-800 hover:bg-purple-200 border-none',
    placeholder: 'Search suppliers by name, code, or email...',
  },
};

const MEMBERSHIP_OPTIONS = ['bronze', 'silver', 'gold'] as const;
const GENDER_OPTIONS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export function PartnersList({ partnerType }: { partnerType?: PartnerTypeFilter }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [deleting, setDeleting] = useState<Partner | null>(null);
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [membershipLevel, setMembershipLevel] = useState('');
  const [gender, setGender] = useState('');
  const [notes, setNotes] = useState('');
  const [contactFirstName, setContactFirstName] = useState('');
  const [contactLastName, setContactLastName] = useState('');
  const [contactPosition, setContactPosition] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [addrType, setAddrType] = useState<'billing' | 'shipping'>('shipping');
  const [addrLine1, setAddrLine1] = useState('');
  const [addrLine2, setAddrLine2] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrState, setAddrState] = useState('');
  const [addrPostalCode, setAddrPostalCode] = useState('');
  const [addrCountry, setAddrCountry] = useState('');
  const [loyaltyEarned, setLoyaltyEarned] = useState<number | null>(null);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission(PERMISSIONS.partners.view);
  const canCreate = hasPermission(PERMISSIONS.partners.create);
  const canEdit = hasPermission(PERMISSIONS.partners.edit);
  const canDelete = hasPermission(PERMISSIONS.partners.delete);

  useEffect(() => setPage(1), [search]);

  const { data, isLoading } = usePartners(
    { page, pageSize, search: search || undefined },
    { enabled: canView },
  );
  const createPartner = useCreatePartner();
  const updatePartner = useUpdatePartner();
  const deletePartner = useDeletePartner();

  const cfg = partnerType ? TYPE_CFG[partnerType] : null;

  const { data: loyaltyData } = useLoyaltyEarned(editing?.id ?? '', {
    enabled: !!editing?.id && editing.isCustomer,
  });
  useEffect(() => {
    if (loyaltyData) setLoyaltyEarned(loyaltyData.totalEarned);
  }, [loyaltyData]);

  const defaultFormValues = useMemo<FormValues>(() => {
    const base: FormValues = {
      code: '',
      name: '',
      email: '',
      isCustomer: false,
      isSupplier: false,
      isEmployee: false,
    };
    if (partnerType === 'customer') return { ...base, isCustomer: true };
    if (partnerType === 'supplier') return { ...base, isSupplier: true };
    return { ...base, isCustomer: true, isSupplier: false, isEmployee: false };
  }, [partnerType]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });

  const filteredData = useMemo(() => {
    if (!data?.data || !partnerType) return data;
    return {
      ...data,
      data: data.data.filter((p) => p[cfg!.key]),
    };
  }, [data, partnerType, cfg]);

  const resetForm = useCallback(
    (p?: Partner | null) => {
      const vals: FormValues = {
        code: p?.code ?? '',
        name: p?.name ?? '',
        email: p?.email ?? '',
        isCustomer: p?.isCustomer ?? (partnerType === 'customer'),
        isSupplier: p?.isSupplier ?? (partnerType === 'supplier'),
        isEmployee: p?.isEmployee ?? false,
      };
      form.reset(vals);
      setPhone(p?.phone ?? '');
      setMembershipLevel(p?.membershipLevel ?? '');
      setGender(p?.gender ?? '');
      setNotes(p?.notes ?? '');
      setContactFirstName(p?.contacts?.find((c) => c.isPrimary)?.firstName ?? '');
      setContactLastName(p?.contacts?.find((c) => c.isPrimary)?.lastName ?? '');
      setContactPosition(p?.contacts?.find((c) => c.isPrimary)?.position ?? '');
      setContactEmail(p?.contacts?.find((c) => c.isPrimary)?.email ?? '');
      setContactPhone(p?.contacts?.find((c) => c.isPrimary)?.phone ?? '');
      const shipping = p?.addresses?.find((a) => a.type === 'shipping');
      const primary = p?.addresses?.find((a) => a.isPrimary) ?? shipping;
      setAddrType(primary?.type === 'shipping' ? 'shipping' : 'billing');
      setAddrLine1(primary?.line1 ?? '');
      setAddrLine2(primary?.line2 ?? '');
      setAddrCity(primary?.city ?? '');
      setAddrState(primary?.state ?? '');
      setAddrPostalCode(primary?.postalCode ?? '');
      setAddrCountry(primary?.country ?? '');
      setLoyaltyEarned(p?.loyaltyEarned ?? null);
    },
    [form, partnerType],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    resetForm(null);
    setOpen(true);
  }, [resetForm]);

  const openEdit = useCallback(
    (p: Partner) => {
      setEditing(p);
      resetForm(p);
      setOpen(true);
    },
    [resetForm],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const contacts: Record<string, unknown>[] = [];
      const addresses: Record<string, unknown>[] = [];
      if (contactFirstName.trim() || contactLastName.trim() || contactEmail?.trim()) {
        contacts.push({
          firstName: contactFirstName.trim(),
          lastName: contactLastName.trim() || null,
          position: contactPosition.trim() || null,
          email: contactEmail.trim() || null,
          phone: contactPhone.trim() || null,
          isPrimary: true,
        });
      }
      if (addrLine1.trim()) {
        addresses.push({
          type: addrType,
          line1: addrLine1.trim(),
          line2: addrLine2.trim() || null,
          city: addrCity.trim() || null,
          state: addrState.trim() || null,
          postalCode: addrPostalCode.trim() || null,
          country: addrCountry.trim() || null,
          isPrimary: addresses.length === 0,
        });
      }
      const payload: Record<string, unknown> = {
        ...values,
        phone: phone || null,
        membershipLevel: membershipLevel || null,
        gender: gender || null,
        notes: notes || null,
      };
      if (contacts.length > 0) payload.contacts = contacts;
      if (addresses.length > 0) payload.addresses = addresses;

      if (editing) {
        await updatePartner.mutateAsync({ id: editing.id, data: payload as any });
        notify.success('Partner updated successfully');
      } else {
        await createPartner.mutateAsync(payload as any);
        notify.success('Partner created successfully');
      }
      setOpen(false);
      resetForm(null);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  });

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await deletePartner.mutateAsync(deleting.id);
      notify.success('Partner deleted successfully');
      setDeleting(null);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete partner');
    }
  }, [deleting, deletePartner]);

  const isMutating = createPartner.isPending || updatePartner.isPending || deletePartner.isPending;
  const isCustomer = form.watch('isCustomer');

  const title = cfg ? cfg.labelPlural : 'Partners';
  const subtitle = cfg ? `Manage ${cfg.labelPlural.toLowerCase()}` : 'Manage customers, suppliers, and employees';
  const buttonLabel = editing
    ? `Edit ${partnerType ? cfg!.label : 'Partner'}`
    : partnerType
      ? `New ${cfg!.label}`
      : 'New Partner';
  const searchPlaceholder = cfg ? cfg.placeholder : 'Search partners by name, code, or email...';

  const columns: Column<Partner>[] = useMemo(() => {
    const cols: Column<Partner>[] = [
      {
        key: 'code',
        header: 'Code',
        render: (p) => (
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-gray-400" />
            <span className="font-medium text-gray-800">{p.code}</span>
          </div>
        ),
      },
      {
        key: 'name',
        header: 'Name',
        render: (p) => (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-[#0066aa]/10 flex items-center justify-center">
              <User className="h-4 w-4 text-[#0066aa]" />
            </div>
            <div className="font-medium text-gray-800">{p.name}</div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (p) => {
          if (partnerType === 'customer') {
            return <Badge className={TYPE_CFG.customer.badgeCls}>Customer</Badge>;
          }
          if (partnerType === 'supplier') {
            return <Badge className={TYPE_CFG.supplier.badgeCls}>Supplier</Badge>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {p.isCustomer && <Badge className={TYPE_CFG.customer.badgeCls}>Customer</Badge>}
              {p.isSupplier && <Badge className={TYPE_CFG.supplier.badgeCls}>Supplier</Badge>}
              {p.isEmployee && (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-none">Employee</Badge>
              )}
            </div>
          );
        },
      },
      {
        key: 'email',
        header: 'Email',
        render: (p) =>
          p.email ? (
            <div className="flex items-center gap-2 text-gray-600">
              <Mail className="h-4 w-4" />
              {p.email}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => (
          <Badge
            variant={p.status === 'active' ? 'default' : 'secondary'}
            className={p.status === 'active' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-none' : ''}
          >
            {p.status === 'active' ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
    ];

    cols.push({
      key: 'actions',
      header: 'Actions',
      render: (p: Partner) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(p.isCustomer ? `/customers/${p.id}` : `/suppliers/${p.id}`)}
            aria-label={`View ${p.name}`}
            title="View"
            className="h-8 w-8 p-0 hover:bg-gray-50 hover:text-gray-600"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openEdit(p)}
              aria-label={`Edit ${p.name}`}
              title="Edit"
              className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600"
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(p)}
              aria-label={`Delete ${p.name}`}
              title="Delete"
              className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    });

    return cols;
  }, [canEdit, canDelete, navigate, openEdit, partnerType]);

  const meta = filteredData?.meta;

  if (!canView) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">You do not have permission to view partners.</p>
        </div>
      </div>
    );
  }

  const typeSelectionTitle = partnerType ? `${cfg!.label} Type` : 'Partner Type';
  const typeCreateSubtitle = editing ? 'Update partner information' : partnerType
    ? `Create a new ${cfg!.label.toLowerCase()}`
    : 'Create a new customer, supplier, or employee';
  const dialogTitle = editing ? `Edit ${partnerType ? cfg!.label : 'Partner'}` : buttonLabel;
  const dialogBtnLabel = `${editing ? 'Update' : 'Create'} ${partnerType ? cfg!.label : 'Partner'}`;
  const HeaderIcon = partnerType ? cfg!.icon : Building2;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        {canCreate && (
          <Button onClick={openCreate} disabled={isMutating} className="gap-2 bg-[#0066aa] hover:bg-[#005599] text-white">
            <Plus className="h-4 w-4" />
            {buttonLabel}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-sm text-gray-600">Show:</Label>
            <select
              className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0066aa]/20"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <DataTable
          columns={columns}
          data={filteredData?.data ?? []}
          loading={isLoading}
          getRowId={(p) => p.id}
          emptyMessage={
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <Users className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">No {cfg ? cfg.label.toLowerCase() + 's' : 'partners'} found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {search ? 'Try adjusting your search terms' : `Create your first ${cfg ? cfg.label.toLowerCase() : 'partner'} to get started`}
              </p>
              {!search && canCreate && (
                <Button onClick={openCreate} className="mt-4" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Create {cfg ? cfg.label : 'Partner'}
                </Button>
              )}
            </div>
          }
        />
      </div>

      {meta && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-600">
            Showing <span className="font-medium text-gray-800">{(page - 1) * pageSize + 1}</span> to{' '}
            <span className="font-medium text-gray-800">{Math.min(page * pageSize, meta.total)}</span> of{' '}
            <span className="font-medium text-gray-800">{meta.total}</span> {cfg ? cfg.label.toLowerCase() + 's' : 'partners'}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => p - 1)}
              className="border-gray-300"
            >
              Previous
            </Button>
            <span className="text-sm text-gray-600">
              Page {page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="border-gray-300"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[900px] p-0 gap-0 bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader className="bg-[#0066aa] text-white p-6 rounded-t-lg">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white/10 rounded-lg">
                  <HeaderIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-semibold leading-tight">{dialogTitle}</DialogTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-none">
                      {editing ? 'Update' : 'Create'}
                    </Badge>
                    <span className="text-sm text-white/80">{typeCreateSubtitle}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-8 w-8 text-white hover:bg-white/20 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          <form onSubmit={onSubmit} className="p-6 space-y-6">
            {/* ── Basic Information ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-[#f59e0b]" />
                <Label className="text-base font-semibold text-gray-800">Basic Information</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="code" className="text-sm font-medium text-gray-700">
                    Code <span className="text-xs text-muted-foreground">(auto if empty)</span>
                  </Label>
                  <div className="relative">
                    <Code2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="code"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="CUST-001"
                      {...form.register('code')}
                    />
                  </div>
                  {form.formState.errors.code && (
                    <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="name"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="Acme Ltd"
                      {...form.register('name')}
                    />
                  </div>
                  {form.formState.errors.name && (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="contact@example.com"
                      {...form.register('email')}
                    />
                  </div>
                  {form.formState.errors.email && (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
                    Phone
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="phone"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="+256 700 000 000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Contact Details (Customer only) ── */}
            {isCustomer && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-[#f59e0b]" />
                  <Label className="text-base font-semibold text-gray-800">Contact Details</Label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">Membership Level</Label>
                    <Select value={membershipLevel} onValueChange={setMembershipLevel}>
                      <SelectTrigger className="h-11 border-gray-200 rounded-lg">
                        <SelectValue placeholder="Select level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {MEMBERSHIP_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">Gender</Label>
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger className="h-11 border-gray-200 rounded-lg">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        {GENDER_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Partner Type ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[#8b5cf6]" />
                <Label className="text-base font-semibold text-gray-800">{typeSelectionTitle}</Label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(partnerType
                  ? ALL_PARTNER_TYPES.filter((t) => {
                      if (partnerType === 'customer') return t.key === 'isCustomer';
                      if (partnerType === 'supplier') return t.key === 'isSupplier';
                      return true;
                    })
                  : ALL_PARTNER_TYPES
                ).map((type) => {
                  const Icon = type.icon;
                  const locked = !!partnerType;
                  const fieldValue = partnerType
                    ? partnerType === 'customer'
                      ? form.getValues('isCustomer')
                      : form.getValues('isSupplier')
                    : form.watch(type.key);

                  return (
                    <div
                      key={type.key}
                      className={`rounded-lg border-2 p-4 transition-all duration-200 flex flex-col items-center text-center space-y-3 ${
                        fieldValue
                          ? 'border-[#0066aa] bg-[#0066aa]/5 shadow-sm'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      } ${locked ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                          fieldValue ? 'bg-[#0066aa] text-white' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-gray-800">{type.label}</div>
                        <div className="text-xs text-gray-500 mt-1">{type.description}</div>
                      </div>
                      {locked && (
                        <span className="text-[10px] font-medium text-[#0066aa] uppercase tracking-wider">
                          {partnerType ? (partnerType === 'customer' ? 'Customer' : 'Supplier') : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {partnerType && (
                <p className="text-xs text-gray-400">This partner type is locked for this view.</p>
              )}
            </div>

            {/* ── Primary Contact Person ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-[#f59e0b]" />
                <Label className="text-base font-semibold text-gray-800">Primary Contact Person</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactFirstName" className="text-sm font-medium text-gray-700">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="contactFirstName"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="John"
                      value={contactFirstName}
                      onChange={(e) => setContactFirstName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactLastName" className="text-sm font-medium text-gray-700">Last Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="contactLastName"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="Doe"
                      value={contactLastName}
                      onChange={(e) => setContactLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPosition" className="text-sm font-medium text-gray-700">Position / Title</Label>
                  <Input
                    id="contactPosition"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="Procurement Manager"
                    value={contactPosition}
                    onChange={(e) => setContactPosition(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail" className="text-sm font-medium text-gray-700">Contact Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="contactEmail"
                      type="email"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="john@example.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="contactPhone" className="text-sm font-medium text-gray-700">Contact Phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="contactPhone"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="+256 700 000 000"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Address ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#f59e0b]" />
                <Label className="text-base font-semibold text-gray-800">Address</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">Address Type</Label>
                  <Select value={addrType} onValueChange={(v) => setAddrType(v as 'billing' | 'shipping')}>
                    <SelectTrigger className="h-11 border-gray-200 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shipping">Delivery / Shipping</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="addrLine1" className="text-sm font-medium text-gray-700">Address Line 1</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="addrLine1"
                      className="pl-10 h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                      placeholder="123 Main Street"
                      value={addrLine1}
                      onChange={(e) => setAddrLine1(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="addrLine2" className="text-sm font-medium text-gray-700">Address Line 2</Label>
                  <Input
                    id="addrLine2"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="Apt, suite, etc."
                    value={addrLine2}
                    onChange={(e) => setAddrLine2(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrCity" className="text-sm font-medium text-gray-700">City</Label>
                  <Input
                    id="addrCity"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="Kampala"
                    value={addrCity}
                    onChange={(e) => setAddrCity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrState" className="text-sm font-medium text-gray-700">State / Region</Label>
                  <Input
                    id="addrState"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="Central Region"
                    value={addrState}
                    onChange={(e) => setAddrState(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrPostalCode" className="text-sm font-medium text-gray-700">Postal Code</Label>
                  <Input
                    id="addrPostalCode"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="256"
                    value={addrPostalCode}
                    onChange={(e) => setAddrPostalCode(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addrCountry" className="text-sm font-medium text-gray-700">Country</Label>
                  <Input
                    id="addrCountry"
                    className="h-11 border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa]"
                    placeholder="Uganda"
                    value={addrCountry}
                    onChange={(e) => setAddrCountry(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* ── Loyalty Points (Customer only) ── */}
            {isCustomer && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-[#f59e0b]" />
                  <Label className="text-base font-semibold text-gray-800">Loyalty Points</Label>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  {editing ? (
                    loyaltyEarned !== null ? (
                      <div className="flex items-center gap-2">
                        <Award className="h-5 w-5 text-amber-600" />
                        <span className="text-lg font-extrabold text-amber-900">
                          {loyaltyEarned.toLocaleString()}
                        </span>
                        <span className="text-sm text-amber-700">points earned (lifetime)</span>
                      </div>
                    ) : (
                      <p className="text-sm text-amber-600">Loading loyalty data...</p>
                    )
                  ) : (
                    <p className="text-sm text-amber-600">Points will be tracked after the customer makes their first purchase.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Notes ── */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#f59e0b]" />
                <Label htmlFor="notes" className="text-base font-semibold text-gray-800">Notes</Label>
              </div>
              <Textarea
                id="notes"
                className="border-gray-200 rounded-lg focus:border-[#0066aa] focus:ring-[#0066aa] min-h-[80px]"
                placeholder="Any additional notes about this partner..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </form>

          <DialogFooter className="p-6 border-t border-gray-200 bg-gray-50/50 rounded-b-lg gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="h-11 px-6 rounded-lg border-gray-300 hover:bg-gray-100"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              onClick={onSubmit}
              disabled={isMutating}
              className="h-11 px-6 rounded-lg bg-[#10b981] hover:bg-[#059669] text-white font-medium"
            >
              {createPartner.isPending || updatePartner.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Saving...
                </span>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {dialogBtnLabel}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="p-0 gap-0">
          <AlertDialogHeader className="bg-[#0066aa] text-white p-6 rounded-t-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                <Trash2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <AlertDialogTitle>Delete Partner</AlertDialogTitle>
                <AlertDialogDescription className="text-white/80 mt-1">
                  This action cannot be undone.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="p-6">
            <p className="text-sm text-gray-600">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-gray-800">{deleting?.name}</span>{' '}
              <span className="text-gray-500">({deleting?.code})</span>?
            </p>
          </div>
          <AlertDialogFooter className="p-6 border-t border-gray-200 bg-gray-50/50 rounded-b-lg gap-2">
            <AlertDialogCancel className="h-11 px-6 rounded-lg border-gray-300 hover:bg-gray-100">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deletePartner.isPending}
              className="h-11 px-6 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deletePartner.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Deleting...
                </span>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Partner
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
