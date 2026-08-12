import { PartnersList } from '@/components/partners/PartnersPage';
import { PartnerDetailPage } from '@/pages/partners/PartnerDetailPage';

export function CustomersPage() {
  return <PartnersList partnerType="customer" />;
}

export function CustomerDetailPage() {
  return <PartnerDetailPage partnerType="customer" />;
}
