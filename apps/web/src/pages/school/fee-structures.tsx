import { StructuresTab } from './fees';

export function SchoolFeeStructuresPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Structures</h1>
        <p className="text-sm text-muted-foreground">
          Define the fee components that apply per academic year, then schedule a structure to a term so invoices are
          generated. A component's code should reference a Fee Category.
        </p>
      </div>
      <StructuresTab />
    </div>
  );
}
