import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ArrowLeft, Coffee, Info, Package, Layers, SlidersHorizontal, UtensilsCrossed, RefreshCw, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/utils';
import { date } from '@/lib/format';
import { useMenuItem } from '@/features/menu/api';
import { useMenuItemBundle } from '@/pages/pos/pos-features-api';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-32 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function TabOverview({ item }: { item: NonNullable<ReturnType<typeof useMenuItem>['data']> }) {
  const priceMajor = item.basePrice != null ? Number(item.basePrice) : null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Item Details</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <dl className="divide-y">
            <InfoRow label="Name" value={<span className="font-semibold">{item.name}</span>} />
            <InfoRow label="Code" value={item.code ? <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{item.code}</code> : null} />
            <InfoRow label="Description" value={item.description} />
            <InfoRow label="Category" value={item.category?.name ? <span className="font-semibold">{item.category.name}</span> : null} />
            <InfoRow label="Status" value={item.isAvailable ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Available</Badge> : <Badge variant="secondary" className="text-xs">Unavailable</Badge>} />
            <InfoRow label="Prep Time" value={item.preparationTime != null ? `${item.preparationTime}m` : null} />
            <InfoRow label="Display Order" value={item.displayOrder != null ? String(item.displayOrder) : null} />
          </dl>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pricing</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <dl className="divide-y">
              <InfoRow label="Base Price" value={priceMajor != null ? <span className="font-bold text-lg text-emerald-600">{formatCurrency(priceMajor)}</span> : <span className="text-muted-foreground">Derived from variants</span>} />
              <InfoRow label="Image" value={item.image ? <img src={item.image} alt={item.name} className="h-16 w-16 object-cover rounded border" /> : null} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <dl className="divide-y">
              <InfoRow label="Created" value={date(item.createdAt)} />
              <InfoRow label="Last Updated" value={date(item.updatedAt)} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TabIngredients({ item }: { item: NonNullable<ReturnType<typeof useMenuItem>['data']> }) {
  const ingredients = item.ingredients ?? [];
  if (ingredients.length === 0) return (
    <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
      <Package className="h-10 w-10 opacity-30" />
      <p className="font-semibold">No ingredients configured</p>
      <p className="text-xs">Add ingredients to track what products are consumed when this menu item is sold</p>
    </CardContent></Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Ingredients</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Product</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Code</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Qty Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ingredients.map((ing) => (
            <TableRow key={ing.id} className="hover:bg-muted/20">
              <TableCell className="font-semibold text-sm">{ing.product?.name ?? '—'}</TableCell>
              <TableCell>{ing.product?.code && <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-primary">{ing.product.code}</code>}</TableCell>
              <TableCell className="text-right font-bold text-sm">{Number(ing.quantity).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabVariants({ bundle }: { bundle: NonNullable<ReturnType<typeof useMenuItemBundle>['data']> }) {
  const variants = bundle.variants ?? [];
  if (variants.length === 0) return (
    <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
      <Layers className="h-10 w-10 opacity-30" />
      <p className="font-semibold">No variants configured</p>
      <p className="text-xs">Variants allow different sizes or versions with their own prices</p>
    </CardContent></Card>
  );
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Variants</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs font-bold text-muted-foreground uppercase">Name</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Price</TableHead>
            <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Sort Order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((v) => (
            <TableRow key={v.id} className="hover:bg-muted/20">
              <TableCell className="font-semibold text-sm">{v.name}</TableCell>
              <TableCell className="text-right font-bold text-sm text-emerald-600">{formatCurrency(v.price)}</TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">{v.sortOrder}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabModifiers({ bundle }: { bundle: NonNullable<ReturnType<typeof useMenuItemBundle>['data']> }) {
  const groups = bundle.groups ?? [];
  if (groups.length === 0) return (
    <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
      <SlidersHorizontal className="h-10 w-10 opacity-30" />
      <p className="font-semibold">No modifier groups assigned</p>
      <p className="text-xs">Add modifiers for add-ons (extra shot) or prep instructions (well done)</p>
    </CardContent></Card>
  );
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.id}>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{g.name}</CardTitle>
              <Badge variant="outline" className="text-xs capitalize">{g.groupType.toLowerCase().replace(/_/g, ' ')}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">Min {g.minSelect} &middot; Max {g.maxSelect}</div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-3">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase">Option</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Price Delta</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-center">Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.modifiers.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/20">
                    <TableCell className="font-semibold text-sm">{m.name}</TableCell>
                    <TableCell className="text-right text-sm">{m.priceDelta ? formatCurrency(m.priceDelta) : '—'}</TableCell>
                    <TableCell className="text-center">{m.isDefault ? <Badge className="bg-emerald-100 text-emerald-700 text-xs">Default</Badge> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TabAccompaniments({ bundle }: { bundle: NonNullable<ReturnType<typeof useMenuItemBundle>['data']> }) {
  const groups = bundle.accompanimentGroups ?? [];
  if (groups.length === 0) return (
    <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-2">
      <UtensilsCrossed className="h-10 w-10 opacity-30" />
      <p className="font-semibold">No accompaniments configured</p>
      <p className="text-xs">Accompaniment groups define side dishes or add-ons like &ldquo;Choose 1 Side&rdquo;</p>
    </CardContent></Card>
  );
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.id}>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{g.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{g.isRequired ? 'Required' : 'Optional'} &middot; Choose {g.minSelect}-{g.maxSelect}</p>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-3">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase">Option</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Price Impact</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-center">Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.options.map((o) => (
                  <TableRow key={o.id} className="hover:bg-muted/20">
                    <TableCell className="font-semibold text-sm">{o.name}</TableCell>
                    <TableCell className="text-right text-sm">{o.priceImpact ? formatCurrency(o.priceImpact) : '—'}</TableCell>
                    <TableCell className="text-center">{o.isDefault ? <Badge className="bg-emerald-100 text-emerald-700 text-xs">Default</Badge> : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function MenuDetailPage() {
  const navigate = useNavigate();
  const { menuItemId } = useParams<{ menuItemId: string }>();
  const { data: item, isLoading } = useMenuItem(menuItemId);
  const { data: bundle } = useMenuItemBundle(menuItemId ?? null);
  const [activeTab, setActiveTab] = useState('overview');

  const ingredientCount = item?.ingredients?.length ?? 0;
  const variantCount = bundle?.variants?.length ?? 0;
  const modifierCount = bundle?.groups?.length ?? 0;
  const accompCount = bundle?.accompanimentGroups?.length ?? 0;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info, count: null },
    { id: 'ingredients', label: 'Ingredients', icon: Package, count: ingredientCount },
    { id: 'variants', label: 'Variants', icon: Layers, count: variantCount },
    { id: 'modifiers', label: 'Modifiers', icon: SlidersHorizontal, count: modifierCount },
    { id: 'accompaniments', label: 'Accompaniments', icon: UtensilsCrossed, count: accompCount },
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center"><Coffee className="h-12 w-12 opacity-30 mx-auto mb-2" /><p className="font-semibold">Menu item not found</p></div>
      </div>
    );
  }

  const priceMajor = item.basePrice != null ? Number(item.basePrice) : null;

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b bg-white shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <button onClick={() => navigate('/menu')} className="hover:text-primary transition-colors font-medium">Menu</button>
            <ChevronRight className="h-3 w-3" />
            <span className="font-semibold">{item.name}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate('/menu')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><Coffee className="h-5 w-5 text-primary" /></div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold">{item.name}</h1>
                  {item.code && <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{item.code}</code>}
                  {item.isAvailable ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Available</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Unavailable</Badge>
                  )}
                </div>
                {item.category && <p className="text-sm text-muted-foreground mt-0.5">{item.category.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => window.location.reload()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
              <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10 font-semibold" onClick={() => navigate('/menu')}>
                <Edit className="h-4 w-4 mr-1.5" /> Edit
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-6 mt-3 pt-3 border-t">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Price:</span>
              <span className="font-bold text-sm text-emerald-600">{priceMajor ? formatCurrency(priceMajor) : 'See variants'}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Prep Time:</span>
              <span className="font-semibold text-sm">{item.preparationTime ? `${item.preparationTime}m` : '—'}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Ingredients:</span>
              <span className="font-semibold text-sm">{ingredientCount}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
              <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}
                    className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
                  >
                    <span className="flex items-center gap-2">
                      <tab.icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{tab.label}</span>
                      {tab.count !== null && tab.count > 0 && (
                        <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tighter ${tab.id === activeTab ? 'bg-indigo-100 text-indigo-700' : 'bg-white/20 text-white'}`}>
                          {tab.count}
                        </span>
                      )}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex-1 overflow-auto py-2 px-2">
              <TabsContent value="overview" className="mt-0 outline-none"><TabOverview item={item} /></TabsContent>
              <TabsContent value="ingredients" className="mt-0 outline-none"><TabIngredients item={item} /></TabsContent>
              <TabsContent value="variants" className="mt-0 outline-none">{bundle ? <TabVariants bundle={bundle} /> : <Skeleton className="h-40" />}</TabsContent>
              <TabsContent value="modifiers" className="mt-0 outline-none">{bundle ? <TabModifiers bundle={bundle} /> : <Skeleton className="h-40" />}</TabsContent>
              <TabsContent value="accompaniments" className="mt-0 outline-none">{bundle ? <TabAccompaniments bundle={bundle} /> : <Skeleton className="h-40" />}</TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </TooltipProvider>
  );
}
