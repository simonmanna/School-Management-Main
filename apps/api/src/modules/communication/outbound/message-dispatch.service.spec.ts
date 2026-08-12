import { MessageDispatchService } from './message-dispatch.service';

describe('MessageDispatchService idempotency', () => {
  it('derives a stable, structured idempotency key', () => {
    const key = MessageDispatchService.idempotencyKey('whatsapp', 'chan-1', 'msg-1', '+256700000000');
    expect(key).toBe('whatsapp:chan-1:msg-1:+256700000000');
  });

  it('passes the opaque key through as providerRequestId for non-WhatsApp providers', () => {
    const key = MessageDispatchService.idempotencyKey('internal', 'chan-1', 'msg-1', 'chan-1');
    expect(MessageDispatchService.providerRequestId('internal', key)).toBe(key);
    expect(MessageDispatchService.providerRequestId('telegram', 'telegram:c:m:123')).toBe('telegram:c:m:123');
  });

  it('derives a WhatsApp-shaped id that is deterministic across retries', () => {
    const key = MessageDispatchService.idempotencyKey('whatsapp', 'chan-1', 'msg-1', '+256700000000');
    const a = MessageDispatchService.providerRequestId('whatsapp', key);
    const b = MessageDispatchService.providerRequestId('whatsapp', key);
    // Same input ⇒ same id ⇒ a retry after an ambiguous timeout dedupes provider-side.
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{22}$/);
  });

  it('produces different provider ids for different recipients', () => {
    const k1 = MessageDispatchService.idempotencyKey('whatsapp', 'c', 'm', '+111');
    const k2 = MessageDispatchService.idempotencyKey('whatsapp', 'c', 'm', '+222');
    expect(MessageDispatchService.providerRequestId('whatsapp', k1)).not.toBe(
      MessageDispatchService.providerRequestId('whatsapp', k2),
    );
  });
});
