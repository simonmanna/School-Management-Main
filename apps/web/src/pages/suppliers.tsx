import { PartnersList } from '@/components/partners/PartnersPage';
import { PartnerDetailPage } from '@/pages/partners/PartnerDetailPage';

export function SuppliersPage() {
  return <PartnersList partnerType="supplier" />;
}

export function SupplierDetailPage() {
  return <PartnerDetailPage partnerType="supplier" />;
}
