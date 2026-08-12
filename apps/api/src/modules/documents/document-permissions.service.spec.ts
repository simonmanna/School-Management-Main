/**
 * Unit: granular document permission fallback chain (§4):
 * exact type → category → generic. No DB — pure resolution logic.
 */
import { DocumentPermissionsService, PermissionSubject } from './document-permissions.service';

describe('DocumentPermissionsService', () => {
  const svc = new DocumentPermissionsService();

  const salesInvoice: PermissionSubject = {
    code: 'sales_invoice',
    category: 'retail',
    security: { basePermission: 'document', visibility: 'org' },
  };
  const customDefaultBase: PermissionSubject = {
    code: 'pos_receipt',
    category: 'pos',
  };

  it('grants via exact type key', () => {
    expect(svc.resolveKey(['document:sales_invoice:post'], salesInvoice, 'post')).toBe(
      'document:sales_invoice:post',
    );
    expect(svc.can(['document:sales_invoice:post'], salesInvoice, 'post')).toBe(true);
  });

  it('falls back to category key when no exact key', () => {
    expect(svc.resolveKey(['document:retail:post'], salesInvoice, 'post')).toBe('document:retail:post');
    expect(svc.can(['document:retail:post'], salesInvoice, 'post')).toBe(true);
  });

  it('falls back to generic key', () => {
    expect(svc.resolveKey(['document:read'], salesInvoice, 'read')).toBe('document:read');
    expect(svc.resolveKey(['document:read'], null, 'read')).toBe('document:read');
  });

  it('denies when no key matches', () => {
    expect(svc.resolveKey(['document:sales_invoice:submit'], salesInvoice, 'post')).toBeNull();
    expect(svc.can(['document:cashier_read'], salesInvoice, 'post')).toBe(false);
    expect(svc.can([], salesInvoice, 'post')).toBe(false);
  });

  it('exact key wins over category and generic', () => {
    const keys = ['document:read', 'document:retail:post', 'document:sales_invoice:post'];
    expect(svc.resolveKey(keys, salesInvoice, 'post')).toBe('document:sales_invoice:post');
  });

  it('uses default basePermission when security missing', () => {
    expect(svc.resolveKey(['document:pos_receipt:post'], customDefaultBase, 'post')).toBe(
      'document:pos_receipt:post',
    );
  });

  it('does not leak other-type keys across categories', () => {
    // school key must NOT grant a retail document (different type AND category)
    expect(svc.can(['document:school_fee_invoice:post'], salesInvoice, 'post')).toBe(false);
    // same category but different type must not grant either
    expect(svc.can(['document:quotation:post'], salesInvoice, 'post')).toBe(false);
  });
});