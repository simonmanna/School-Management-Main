import {
  isSuccessResponse,
  normalizeE164,
  parseGatewayConfig,
  readPath,
  renderTemplate,
} from './sms-gateway.config';

const ctx = {
  to: '+256772123456',
  from: 'SCHOOL',
  text: 'Fees are due',
  requestId: 'sms:ch1:msg1:+256772123456',
  secrets: { apiKey: 'k-123', username: 'sandbox' },
};

describe('renderTemplate', () => {
  it('substitutes the transport placeholders', () => {
    expect(renderTemplate('{{from}} -> {{to}}: {{text}}', ctx)).toBe('SCHOOL -> +256772123456: Fees are due');
  });

  it('{{toLocal}} drops the leading + for gateways that reject it', () => {
    expect(renderTemplate('{{toLocal}}', ctx)).toBe('256772123456');
  });

  it('resolves secrets from the decrypted bag', () => {
    expect(renderTemplate('Bearer {{secret.apiKey}}', ctx)).toBe('Bearer k-123');
  });

  it('throws on a missing secret rather than sending an empty credential', () => {
    // Rendering `apiKey=` produces an opaque 401 that looks like a network fault
    // and gets retried six times. Failing here names the missing key instead.
    expect(() => renderTemplate('{{secret.nope}}', ctx)).toThrow(/missing secret 'nope'/);
  });

  it('throws on an unknown placeholder', () => {
    expect(() => renderTemplate('{{wat}}', ctx)).toThrow(/Unknown SMS gateway placeholder/);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ to }}', ctx)).toBe('+256772123456');
  });
});

describe('readPath', () => {
  const payload = {
    SMSMessageData: { Recipients: [{ messageId: 'ATXid_9', status: 'Success' }] },
    ok: true,
  };

  it('walks dotted paths through arrays', () => {
    expect(readPath(payload, 'SMSMessageData.Recipients.0.messageId')).toBe('ATXid_9');
  });

  it('returns undefined for a missing path rather than throwing', () => {
    expect(readPath(payload, 'SMSMessageData.Nope.0.id')).toBeUndefined();
    expect(readPath(payload, '')).toBeUndefined();
  });
});

describe('isSuccessResponse', () => {
  const body = { status: 'Success', code: 200 };

  it('no predicate means the HTTP status already decided', () => {
    expect(isSuccessResponse(body, {})).toBe(true);
  });

  it('equals compares stringified, so 200 and "200" agree', () => {
    expect(isSuccessResponse(body, { successWhen: { path: 'code', equals: '200' } })).toBe(true);
    expect(isSuccessResponse(body, { successWhen: { path: 'code', equals: 500 } })).toBe(false);
  });

  it('in checks membership', () => {
    expect(isSuccessResponse(body, { successWhen: { path: 'status', in: ['Success', 'Queued'] } })).toBe(true);
    expect(isSuccessResponse(body, { successWhen: { path: 'status', in: ['Queued'] } })).toBe(false);
  });

  it('catches an HTTP 200 carrying an in-body failure', () => {
    // The most common gateway shape, and the reason this predicate exists.
    expect(isSuccessResponse({ status: 'Failed' }, { successWhen: { path: 'status', equals: 'Success' } })).toBe(false);
  });

  it('a bare path means "present and truthy"', () => {
    expect(isSuccessResponse({ messageId: 'x' }, { successWhen: { path: 'messageId' } })).toBe(true);
    expect(isSuccessResponse({ messageId: '' }, { successWhen: { path: 'messageId' } })).toBe(false);
  });
});

describe('normalizeE164', () => {
  it('collapses every human spelling of one handset to one string', () => {
    // This string is the consent key AND part of the delivery idempotency key —
    // two spellings would mean an opt-out that only half works.
    const forms = ['+256772123456', '256772123456', '0772 123456', '(0772) 123-456', '+256-772-123456'];
    const normalized = new Set(forms.map((f) => normalizeE164(f, '+256')));
    expect(normalized).toEqual(new Set(['+256772123456']));
  });

  it('keeps an explicit + as authoritative and ignores the default code', () => {
    expect(normalizeE164('+14155552671', '+256')).toBe('+14155552671');
  });

  it('strips the national trunk prefix before prepending the country code', () => {
    expect(normalizeE164('0772123456', '+256')).toBe('+256772123456');
    expect(normalizeE164('0772123456', '+256')).not.toBe('+2560772123456');
  });

  it('leaves an already-prefixed national number alone', () => {
    expect(normalizeE164('256772123456', '+256')).toBe('+256772123456');
  });

  it('rejects rubbish rather than sending to it', () => {
    expect(() => normalizeE164('', '+256')).toThrow();
    expect(() => normalizeE164('n/a', '+256')).toThrow(/no digits/);
    expect(() => normalizeE164('123', '+256')).toThrow(/8-15 digits/);
  });
});

describe('parseGatewayConfig', () => {
  const valid = {
    endpoint: 'https://api.example.com/send',
    method: 'POST',
    bodyEncoding: 'json',
    params: { to: '{{to}}', message: '{{text}}', from: '{{from}}' },
    response: { messageIdPath: 'id' },
  };

  it('accepts a well-formed config and fills defaults', () => {
    const c = parseGatewayConfig(valid);
    expect(c.method).toBe('POST');
    expect(c.requestTimeoutMs).toBe(20_000);
  });

  it('rejects plain http to a remote host — credentials travel in this request', () => {
    expect(() => parseGatewayConfig({ ...valid, endpoint: 'http://api.example.com/send' })).toThrow(/https/);
  });

  it('allows plain http to localhost for a local SMPP shim', () => {
    expect(() => parseGatewayConfig({ ...valid, endpoint: 'http://localhost:8080/send' })).not.toThrow();
  });

  it('rejects params with no destination or no body', () => {
    expect(() => parseGatewayConfig({ ...valid, params: { message: '{{text}}' } })).toThrow(/\{\{to\}\}/);
    expect(() => parseGatewayConfig({ ...valid, params: { to: '{{to}}' } })).toThrow(/\{\{text\}\}/);
  });

  it('accepts {{toLocal}} as the destination', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, params: { msisdn: '{{toLocal}}', text: '{{text}}' } }),
    ).not.toThrow();
  });

  it('requires a complete DLR mapping when dlr is configured', () => {
    expect(() => parseGatewayConfig({ ...valid, dlr: { messageIdPath: 'id' } })).toThrow(/statusPath/);
    expect(() =>
      parseGatewayConfig({ ...valid, dlr: { messageIdPath: 'id', statusPath: 's', statusMap: {} } }),
    ).toThrow(/statusMap/);
  });

  it('rejects a malformed default country code', () => {
    expect(() => parseGatewayConfig({ ...valid, defaultCountryCode: 'UG' })).toThrow(/defaultCountryCode/);
  });

  it('reports every problem at once so the operator fixes them in one pass', () => {
    expect(() => parseGatewayConfig({ params: {} })).toThrow(/endpoint is required.*params/s);
  });
});
