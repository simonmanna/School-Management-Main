import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ChevronRight, ArrowLeft, Save, Package, Plus, Trash2,
  DollarSign, FlaskConical, Boxes, BookOpen,
  PackageOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import {
  useCreateProduct, useProductCategories, useProducts, useUpdateProduct,
  type ProductCategory,
} from '@/features/products/api';
import { useUoms } from '@/features/uom/api';
import { useAccounts, type Account } from '@/features/accounting/api';
import { useKitchenStations } from '@/pages/pos/pos-features-api';
import { api, resolveAssetUrl } from '@/lib/api';
import { toast } from 'sonner';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PRODUCT_TYPES = ['stockable', 'consumable', 'service', 'fee', 'subscription', 'asset'] as const;

const MEASUREMENT_METHODS = [
  { value: 'count', label: 'Count units' },
  { value: 'manual_volume', label: 'Manual remaining volume' },
  { value: 'digital_weight', label: 'Digital weight scale (bar alcohol)' },
] as const;

const COSTING_METHODS = [
  { value: 'AVCO', label: 'Average Cost (AVCO)' },
  { value: 'FIFO', label: 'First-In, First-Out (FIFO)' },
  { value: 'STANDARD', label: 'Standard Cost' },
  { value: 'SPECIFIC', label: 'Specific Identification' },
] as const;

const PICKING_STRATEGIES = [
  { value: 'FEFO', label: 'FEFO — nearest expiry first' },
  { value: 'FIFO', label: 'FIFO — oldest receipt first' },
  { value: 'MANUAL', label: 'Manual batch selection' },
  { value: 'SERIAL', label: 'Serial selection' },
] as const;

const INVENTORY_DEFAULTS = {
  batchTracking: false,
  expiryTracking: false,
  serialTracking: false,
  pickingStrategy: 'FEFO',
} as const;

const UOM_DEFAULTS = {
  uomId: '',
  purchaseUomId: '',
  salesUomId: '',
  recipeUomId: '',
  productionUomId: '',
  uomConversion: '',
  reorderQty: '',
  station: 'cafe',
  allowFractionalSale: true,
  minSaleQty: '',
  maxSaleQty: '',
} as const;

const schema = z.object({
  code: z.string().min(1, 'Code is required'),
  sku: z.string().optional().or(z.literal('')),
  name: z.string().min(1, 'Name is required'),
  productType: z.string().min(1),
  costingMethod: z.string(),
  categoryId: z.string().optional().or(z.literal('')),
  salesPrice: z.string().optional().or(z.literal('')),
  costPrice: z.string().optional().or(z.literal('')),
  trackInventory: z.boolean(),
  uomId: z.string().optional().or(z.literal('')),
  purchaseUomId: z.string().optional().or(z.literal('')),
  salesUomId: z.string().optional().or(z.literal('')),
  recipeUomId: z.string().optional().or(z.literal('')),
  productionUomId: z.string().optional().or(z.literal('')),
  uomConversion: z.string().optional().or(z.literal('')),
  reorderQty: z.string().optional().or(z.literal('')),
  station: z.string().optional().or(z.literal('')),
  allowFractionalSale: z.boolean(),
  minSaleQty: z.string().optional().or(z.literal('')),
  maxSaleQty: z.string().optional().or(z.literal('')),
  batchTracking: z.boolean(),
  expiryTracking: z.boolean(),
  serialTracking: z.boolean(),
  pickingStrategy: z.string(),
  measurementMethod: z.string(),
  containerVolumeMl: z.string().optional().or(z.literal('')),
  emptyBottleWeightG: z.string().optional().or(z.literal('')),
  actualEmptyWeightG: z.string().optional().or(z.literal('')),
  fullBottleWeightG: z.string().optional().or(z.literal('')),
  standardPourMl: z.string().optional().or(z.literal('')),
  allowPartialBottle: z.boolean(),
  varianceToleranceG: z.string().optional().or(z.literal('')),
  incomeAccountOverrideId: z.string().optional().or(z.literal('')),
  expenseAccountOverrideId: z.string().optional().or(z.literal('')),
  inventoryAccountOverrideId: z.string().optional().or(z.literal('')),
  cogsAccountOverrideId: z.string().optional().or(z.literal('')),
  shrinkageAccountOverrideId: z.string().optional().or(z.literal('')),
  damageAccountOverrideId: z.string().optional().or(z.literal('')),
  expiryAccountOverrideId: z.string().optional().or(z.literal('')),
  varianceGainAccountOverrideId: z.string().optional().or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

const BEVERAGE_DEFAULTS = {
  measurementMethod: 'count',
  containerVolumeMl: '',
  emptyBottleWeightG: '',
  actualEmptyWeightG: '',
  fullBottleWeightG: '',
  standardPourMl: '',
  allowPartialBottle: true,
  varianceToleranceG: '',
} as const;

// ── Account Select field descriptor ──

type CatAccKey = keyof Omit<ProductCategory, 'id' | 'name' | 'parentId'>;

interface AccDef {
  fieldName: keyof FormValues;
  label: string;
  categoryField: CatAccKey;
  mappingLabel: string;
  mappingKey: string;
}

const ACCOUNT_OVERRIDE_FIELDS: AccDef[] = [
  { fieldName: 'incomeAccountOverrideId', label: 'Income (Revenue)',  categoryField: 'incomeAccountId',  mappingKey: 'sales_revenue',           mappingLabel: 'Sales Revenue' },
  { fieldName: 'expenseAccountOverrideId', label: 'Expense (COGS)',   categoryField: 'expenseAccountId', mappingKey: 'cogs',                   mappingLabel: 'Cost of Goods Sold' },
  { fieldName: 'inventoryAccountOverrideId', label: 'Inventory (Stock)', categoryField: 'inventoryAccountId', mappingKey: 'stock_valuation',     mappingLabel: 'Stock Valuation' },
  { fieldName: 'cogsAccountOverrideId', label: 'COGS (separate)',    categoryField: 'cogsAccountId',     mappingKey: 'cogs',                   mappingLabel: 'Cost of Goods Sold' },
  { fieldName: 'shrinkageAccountOverrideId', label: 'Adj Loss / Shrinkage', categoryField: 'shrinkageAccountId', mappingKey: 'stock_adjustment_expense', mappingLabel: 'Stock Adj Loss' },
  { fieldName: 'varianceGainAccountOverrideId', label: 'Adj Gain / Variance', categoryField: 'varianceGainAccountId', mappingKey: 'stock_adjustment_income',  mappingLabel: 'Stock Adj Gain' },
  { fieldName: 'damageAccountOverrideId', label: 'Damage Write-Off', categoryField: 'damageAccountId',   mappingKey: 'stock_adjustment_expense', mappingLabel: 'Stock Adj Loss' },
  { fieldName: 'expiryAccountOverrideId', label: 'Expiry Write-Off', categoryField: 'expiryAccountId',   mappingKey: 'stock_adjustment_expense', mappingLabel: 'Stock Adj Loss' },
];

// ── Tab definitions matching InventoryDetailPage style ──

interface TabDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: Package },
  { id: 'pricing-uom', label: 'Pricing & UOM', icon: DollarSign },
  { id: 'inventory', label: 'Inventory', icon: PackageOpen },
  { id: 'beverage', label: 'Beverage', icon: FlaskConical },
  { id: 'packaging', label: 'Packaging', icon: Boxes },
  { id: 'accounting', label: 'Accounting', icon: BookOpen },
];

// ---------------------------------------------------------------------------

export function ProductEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const [activeTab, setActiveTab] = useState('general');

  const { data: listData } = useProducts({ page: 1, pageSize: 200 });
  const existingProduct = !isNew ? listData?.data?.find((p) => p.id === id) : null;

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const { data: categories = [] } = useProductCategories();
  const { data: kitchenStations = [] } = useKitchenStations();
  const { data: units = [] } = useUoms();
  const { data: accountsData } = useAccounts();
  const accounts: Account[] = accountsData?.data ?? [];

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const imageFileIdRef = useRef<string>('');
  const [previewSrc, setPreviewSrc] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [packagingRows, setPackagingRows] = useState<{ name: string; quantity: string; barcode: string }[]>([]);
  const updatePack = (i: number, field: 'name' | 'quantity' | 'barcode', val: string) =>
    setPackagingRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: val } : r)));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '', sku: '', name: '', productType: 'stockable', costingMethod: 'AVCO',
      categoryId: '', salesPrice: '', costPrice: '', trackInventory: true,
      ...UOM_DEFAULTS, ...INVENTORY_DEFAULTS, ...BEVERAGE_DEFAULTS,
    },
  });

  // Selected category
  const watchedCategoryId = form.watch('categoryId');
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === watchedCategoryId) ?? null,
    [categories, watchedCategoryId],
  );

  // ── Helper: render a single account select ──
  const renderAccountSelect = useCallback((def: AccDef) => {
    const overrideValue = (form.watch(def.fieldName) as string) ?? '';
    const categoryAccountId = selectedCategory?.[def.categoryField] as string | null | undefined;
    const inheritedAccount = categoryAccountId ? accountMap.get(categoryAccountId) ?? null : null;

    let inheritHint: string;
    if (overrideValue && accountMap.get(overrideValue)) {
      const a = accountMap.get(overrideValue)!;
      inheritHint = `Override set to ${a.code} — ${a.name}`;
    } else if (inheritedAccount) {
      inheritHint = `Inheriting from category "${selectedCategory?.name}": ${inheritedAccount.code} — ${inheritedAccount.name}`;
    } else {
      inheritHint = `No override set — falls back to org Account Mapping: ${def.mappingLabel} (${def.mappingKey})`;
    }

    return (
      <div key={def.fieldName} className="space-y-1.5">
        <Label className="text-sm font-medium">{def.label}</Label>
        <Select
          value={overrideValue}
          onValueChange={(v: string) => form.setValue(def.fieldName, v === '__inherit__' ? '' : v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Inherit (no override)" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="__inherit__">
              <span className="text-muted-foreground italic">— Inherit —</span>
            </SelectItem>
            {accounts
              .filter((a) => a.isActive !== false)
              .map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="font-mono">{a.code}</span> — {a.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">{inheritHint}</p>
      </div>
    );
  }, [form, accounts, accountMap, selectedCategory]);

  // ── Load existing product data for edit mode ──
  useEffect(() => {
    if (!existingProduct) return;
    const p = existingProduct;
    const toStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    form.reset({
      code: p.code,
      sku: p.sku ?? '',
      name: p.name,
      productType: p.productType,
      costingMethod: p.costingMethod ?? 'AVCO',
      categoryId: p.categoryId ?? '',
      salesPrice: p.salesPrice ?? '',
      costPrice: p.costPrice ?? '',
      trackInventory: p.trackInventory,
      uomId: p.uomId ?? '',
      purchaseUomId: p.purchaseUomId ?? '',
      salesUomId: p.salesUomId ?? '',
      recipeUomId: p.recipeUomId ?? '',
      productionUomId: p.productionUomId ?? '',
      uomConversion: toStr(p.uomConversion),
      reorderQty: toStr(p.reorderQty),
      station: p.station ?? 'cafe',
      allowFractionalSale: p.allowFractionalSale ?? true,
      minSaleQty: toStr(p.minSaleQty),
      maxSaleQty: toStr(p.maxSaleQty),
      batchTracking: p.batchTracking ?? false,
      expiryTracking: p.expiryTracking ?? false,
      serialTracking: p.serialTracking ?? false,
      pickingStrategy: p.pickingStrategy ?? 'FEFO',
      measurementMethod: p.measurementMethod ?? 'count',
      containerVolumeMl: toStr(p.containerVolumeMl),
      emptyBottleWeightG: toStr(p.emptyBottleWeightG),
      actualEmptyWeightG: toStr(p.actualEmptyWeightG),
      fullBottleWeightG: toStr(p.fullBottleWeightG),
      standardPourMl: toStr(p.standardPourMl),
      allowPartialBottle: p.allowPartialBottle ?? true,
      varianceToleranceG: toStr(p.varianceToleranceG),
      incomeAccountOverrideId: p.incomeAccountOverrideId ?? '',
      expenseAccountOverrideId: p.expenseAccountOverrideId ?? '',
      inventoryAccountOverrideId: p.inventoryAccountOverrideId ?? '',
      cogsAccountOverrideId: p.cogsAccountOverrideId ?? '',
      shrinkageAccountOverrideId: p.shrinkageAccountOverrideId ?? '',
      damageAccountOverrideId: p.damageAccountOverrideId ?? '',
      expiryAccountOverrideId: p.expiryAccountOverrideId ?? '',
      varianceGainAccountOverrideId: p.varianceGainAccountOverrideId ?? '',
    });
    setPackagingRows(
      (p.packagings ?? []).map((pk) => ({ name: pk.name, quantity: String(pk.quantity), barcode: pk.barcode ?? '' })),
    );
    const raw = p.image ?? '';
    const uuid = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? '';
    if (raw.startsWith('http') || raw.startsWith('/api/v1/files/')) {
      setPreviewSrc(resolveAssetUrl(raw) ?? '');
      imageFileIdRef.current = uuid;
    } else if (raw) {
      imageFileIdRef.current = raw;
      api.post(`/files/${encodeURIComponent(raw)}/signed-url`)
        .then((r) => { if (r.data?.url) setPreviewSrc(resolveAssetUrl(r.data.url) ?? ''); })
        .catch(() => setPreviewSrc(''));
    } else {
      setPreviewSrc('');
      imageFileIdRef.current = '';
    }
  }, [existingProduct]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ownerType', 'product');
      if (id) fd.append('ownerId', id);
      const { data } = await api.post('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const fileId = data.id as string | undefined;
      if (fileId) imageFileIdRef.current = fileId;
      const previewUrl = (data as any).downloadUrl ?? (data as any).url ?? '';
      setPreviewSrc(resolveAssetUrl(previewUrl) ?? '');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Image upload failed');
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      const numOrUndef = (v?: string) => (v !== undefined && v !== '' ? Number(v) : undefined);
      const isWeight = values.measurementMethod === 'digital_weight';
      const payload = {
        ...values,
        sku: values.sku || undefined,
        categoryId: values.categoryId || undefined,
        uomId: values.uomId || undefined,
        purchaseUomId: values.purchaseUomId || undefined,
        salesUomId: values.salesUomId || undefined,
        recipeUomId: values.recipeUomId || undefined,
        productionUomId: values.productionUomId || undefined,
        uomConversion: numOrUndef(values.uomConversion),
        reorderQty: numOrUndef(values.reorderQty),
        station: values.station || undefined,
        allowFractionalSale: values.allowFractionalSale,
        minSaleQty: numOrUndef(values.minSaleQty),
        maxSaleQty: numOrUndef(values.maxSaleQty),
        packagings: packagingRows
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity) || 0, barcode: r.barcode.trim() || undefined })),
        salesPrice: values.salesPrice ? Number(values.salesPrice) : undefined,
        costPrice: values.costPrice ? Number(values.costPrice) : undefined,
        image: imageFileIdRef.current || (previewSrc || undefined),
        measurementMethod: values.measurementMethod,
        containerVolumeMl: isWeight ? numOrUndef(values.containerVolumeMl) : undefined,
        emptyBottleWeightG: isWeight ? numOrUndef(values.emptyBottleWeightG) : undefined,
        actualEmptyWeightG: isWeight ? numOrUndef(values.actualEmptyWeightG) : undefined,
        fullBottleWeightG: isWeight ? numOrUndef(values.fullBottleWeightG) : undefined,
        standardPourMl: isWeight ? numOrUndef(values.standardPourMl) : undefined,
        allowPartialBottle: isWeight ? values.allowPartialBottle : undefined,
        varianceToleranceG: isWeight ? numOrUndef(values.varianceToleranceG) : undefined,
        incomeAccountOverrideId: values.incomeAccountOverrideId || undefined,
        expenseAccountOverrideId: values.expenseAccountOverrideId || undefined,
        inventoryAccountOverrideId: values.inventoryAccountOverrideId || undefined,
        cogsAccountOverrideId: values.cogsAccountOverrideId || undefined,
        shrinkageAccountOverrideId: values.shrinkageAccountOverrideId || undefined,
        damageAccountOverrideId: values.damageAccountOverrideId || undefined,
        expiryAccountOverrideId: values.expiryAccountOverrideId || undefined,
        varianceGainAccountOverrideId: values.varianceGainAccountOverrideId || undefined,
      };
      if (isNew) {
        await createProduct.mutateAsync(payload);
        notify.success('Product created');
      } else {
        await updateProduct.mutateAsync({ id, data: payload });
        notify.success('Product updated');
      }
      navigate('/products');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  });

  if (!isNew && !existingProduct) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const title = isNew ? 'New Product' : existingProduct?.name ?? 'Edit Product';
  const subtitle = isNew
    ? 'Fill in the details to create a new product.'
    : existingProduct?.category?.name ?? 'Update product details below.';

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + Header — matches InventoryDetailPage styling */}
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/products')} className="hover:text-primary transition-colors font-medium">Products</button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{isNew ? 'New Product' : existingProduct?.name}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/products')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><Package className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{title}</h1>
                {!isNew && existingProduct && (
                  <>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{existingProduct.code}</code>
                    <Badge variant={existingProduct.isActive ? 'default' : 'secondary'} className="text-xs">
                      {existingProduct.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate('/products')}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save Product'}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs + Form — matches InventoryDetailPage styling */}
      <form onSubmit={onSubmit} className="flex-1 overflow-auto flex flex-col">
        {/* Gradient tab bar */}
        <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}
                  className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
                >
                  <span className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* ── General Tab ── */}
            <TabsContent value="general" className="mt-0 outline-none space-y-6">
              {/* Basic Info */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="code" className="text-sm font-medium">Code *</Label>
                      <Input id="code" placeholder="PRD-001" {...form.register('code')} />
                      {form.formState.errors.code && (
                        <p className="text-sm text-destructive">{form.formState.errors.code.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">SKU</Label>
                      <Input placeholder="SKU-001" {...form.register('sku')} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Name *</Label>
                    <Input placeholder="Product name" {...form.register('name')} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Product Type</Label>
                      <Select value={form.watch('productType')} onValueChange={(v) => form.setValue('productType', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PRODUCT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Category</Label>
                      <Select value={form.watch('categoryId')} onValueChange={(v) => form.setValue('categoryId', v)}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Costing Method</Label>
                      <Select value={form.watch('costingMethod')} onValueChange={(v) => form.setValue('costingMethod', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COSTING_METHODS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Kitchen Station</Label>
                      <Select value={form.watch('station') || 'cafe'} onValueChange={(v) => form.setValue('station', v)}>
                        <SelectTrigger><SelectValue placeholder="Select station" /></SelectTrigger>
                        <SelectContent>
                          {kitchenStations.map((s) => (
                            <SelectItem key={s.id} value={s.code}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">Which KDS screen this product's tickets route to.</p>
                    </div>
                  </div>
                  {/* Image upload */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Image</Label>
                    <div className="flex items-center gap-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        {uploadingImg ? 'Uploading…' : 'Choose Image'}
                      </Button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      {previewSrc && (
                        <img src={previewSrc} alt="Preview" className="h-12 w-12 object-cover rounded border" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Pricing & UOM Tab ── */}
            <TabsContent value="pricing-uom" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pricing</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Sales Price</Label>
                      <Input type="number" step="0.01" min={0} placeholder="0.00" {...form.register('salesPrice')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Cost Price</Label>
                      <Input type="number" step="0.01" min={0} placeholder="0.00" {...form.register('costPrice')} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Units of Measure</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Stock Unit</Label>
                      <Select value={form.watch('uomId')} onValueChange={(v) => form.setValue('uomId', v)}>
                        <SelectTrigger><SelectValue placeholder="Select UOM" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {units.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Purchase Unit</Label>
                      <Select value={form.watch('purchaseUomId')} onValueChange={(v) => form.setValue('purchaseUomId', v)}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {units.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Sales Unit</Label>
                      <Select value={form.watch('salesUomId')} onValueChange={(v) => form.setValue('salesUomId', v)}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {units.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Recipe Unit</Label>
                      <Select value={form.watch('recipeUomId')} onValueChange={(v) => form.setValue('recipeUomId', v)}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {units.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Production Unit</Label>
                      <Select value={form.watch('productionUomId')} onValueChange={(v) => form.setValue('productionUomId', v)}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {units.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">UOM Conversion</Label>
                      <Input type="number" step="0.01" min={1} placeholder="1" {...form.register('uomConversion')} />
                      <p className="text-[10px] text-muted-foreground">Stock units per 1 purchase unit</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Reorder Qty</Label>
                      <Input type="number" min={0} placeholder="0" {...form.register('reorderQty')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Min Sale Qty</Label>
                      <Input type="number" min={0} step="0.01" placeholder="0" {...form.register('minSaleQty')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Max Sale Qty</Label>
                      <Input type="number" min={0} step="0.01" placeholder="0" {...form.register('maxSaleQty')} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Inventory Tab ── */}
            <TabsContent value="inventory" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Inventory Tracking</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="rounded" checked={form.watch('trackInventory')} onChange={(e) => form.setValue('trackInventory', e.target.checked)} />
                    Track Inventory
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Picking Strategy</Label>
                      <Select value={form.watch('pickingStrategy')} onValueChange={(v) => form.setValue('pickingStrategy', v)} disabled={!form.watch('trackInventory')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PICKING_STRATEGIES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded" checked={form.watch('batchTracking')} onChange={(e) => form.setValue('batchTracking', e.target.checked)} disabled={!form.watch('trackInventory')} />
                      Batch Tracking
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded" checked={form.watch('expiryTracking')} onChange={(e) => form.setValue('expiryTracking', e.target.checked)} disabled={!form.watch('trackInventory')} />
                      Expiry Tracking
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded" checked={form.watch('serialTracking')} onChange={(e) => form.setValue('serialTracking', e.target.checked)} disabled={!form.watch('trackInventory')} />
                      Serial Tracking
                    </label>
                  </div>
                  {form.watch('expiryTracking') && (
                    <p className="text-[11px] text-slate-500">Expiry tracking enables Batch tracking (expiry is recorded per batch).</p>
                  )}
                  {form.watch('costingMethod') === 'SPECIFIC' && !form.watch('serialTracking') && !form.watch('batchTracking') && (
                    <p className="text-[11px] text-amber-600">Specific Identification needs Serial or Batch tracking to identify each unit's cost.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Beverage Tab ── */}
            <TabsContent value="beverage" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Beverage Control</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Measurement Method</Label>
                    <Select value={form.watch('measurementMethod')} onValueChange={(v) => form.setValue('measurementMethod', v)}>
                      <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MEASUREMENT_METHODS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.watch('measurementMethod') === 'digital_weight' && (
                    <div className="grid grid-cols-2 gap-4 border rounded-lg bg-slate-50 p-4">
                      <div className="space-y-1.5">
                        <Label className="text-sm">Container Volume (ml)</Label>
                        <Input type="number" min={0} step="1" placeholder="e.g. 750" {...form.register('containerVolumeMl')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Empty Bottle Weight (g)</Label>
                        <Input type="number" min={0} step="0.1" placeholder="e.g. 400" {...form.register('emptyBottleWeightG')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Full Bottle Weight (g)</Label>
                        <Input type="number" min={0} step="0.1" placeholder="e.g. 1150" {...form.register('fullBottleWeightG')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Standard Pour (ml)</Label>
                        <Input type="number" min={0} step="0.1" placeholder="e.g. 44" {...form.register('standardPourMl')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm">Variance Tolerance (g)</Label>
                        <Input type="number" min={0} step="0.1" placeholder="e.g. 5" {...form.register('varianceToleranceG')} />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" className="rounded" checked={form.watch('allowPartialBottle')} onChange={(e) => form.setValue('allowPartialBottle', e.target.checked)} />
                          Allow Partial Bottle
                        </label>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Packaging Tab ── */}
            <TabsContent value="packaging" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Packaging &amp; Barcodes</CardTitle>
                  <Button type="button" size="sm" variant="outline" onClick={() => setPackagingRows([...packagingRows, { name: '', quantity: '', barcode: '' }])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add pack
                  </Button>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-2">
                  <p className="text-[11px] text-muted-foreground">Each pack = a quantity of the stock unit. Scanning a pack barcode adds that many base units (e.g. a case of 24).</p>
                  {packagingRows.length === 0 && <p className="text-sm text-muted-foreground">No packaging defined.</p>}
                  {packagingRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_130px_1fr_auto] gap-2 items-center">
                      <Input placeholder="Pack name (e.g. Carton)" value={row.name} onChange={(e) => updatePack(i, 'name', e.target.value)} />
                      <Input type="number" step="any" min={0} placeholder="qty of base" value={row.quantity} onChange={(e) => updatePack(i, 'quantity', e.target.value)} />
                      <Input placeholder="Barcode (optional)" value={row.barcode} onChange={(e) => updatePack(i, 'barcode', e.target.value)} />
                      <Button type="button" size="icon" variant="ghost" onClick={() => setPackagingRows(packagingRows.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Accounting Tab ── */}
            <TabsContent value="accounting" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Inventory Accounting Overrides</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-1">
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Leave each field as "<span className="italic">Inherit</span>" to use the category's default (when a category is selected) or the org-level Account Mapping.
                  </p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {ACCOUNT_OVERRIDE_FIELDS.map(renderAccountSelect)}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Bottom actions — always visible */}
          <div className="flex items-center justify-between pt-6 pb-8 border-t mt-6">
            <Button type="button" variant="outline" onClick={() => navigate('/products')}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save Product'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
