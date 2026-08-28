import { useMemo, useState } from 'react';
import { Check, Copy, KeyRound, Save, Webhook } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useUpdateChannel } from '@/features/communication/broadcast-api';

/**
 * SMS gateway configuration.
 *
 * There is no dominant SMS API, so the server drives ONE adapter from a
 * declarative description of the gateway's HTTP shape. That description is what
 * this form edits.
 *
 * Presets exist because nobody should have to know that Africa's Talking returns
 * its message id at `SMSMessageData.Recipients.0.messageId` — but the raw fields
 * stay visible and editable, because the fourth school will use a regional
 * aggregator nobody here has heard of, and that must not require a release.
 *
 * Credentials are write-only: they are sent as `secrets` and never returned, so
 * the field is always blank on load. Saving with it blank keeps what is stored.
 */

interface GatewayConfig {
  endpoint: string;
  method: 'POST' | 'GET';
  bodyEncoding: 'json' | 'form' | 'query';
  senderId?: string;
  headers?: Record<string, string>;
  params: Record<string, string>;
  response: Record<string, unknown>;
  dlr?: Record<string, unknown>;
  inbound?: Record<string, unknown>;
  defaultCountryCode?: string;
  maxSegments?: number;
  costPerSegmentMicros?: number;
  transliterate?: boolean;
  webhookSecret?: string;
}

type PresetId = 'africastalking' | 'twilio' | 'custom';

const PRESETS: Record<Exclude<PresetId, 'custom'>, { label: string; secrets: string[]; config: GatewayConfig }> = {
  africastalking: {
    label: "Africa's Talking",
    secrets: ['username', 'apiKey'],
    config: {
      endpoint: 'https://api.africastalking.com/version1/messaging',
      method: 'POST',
      bodyEncoding: 'form',
      senderId: '',
      headers: { apiKey: '{{secret.apiKey}}' },
      params: { username: '{{secret.username}}', to: '{{to}}', message: '{{text}}', from: '{{from}}' },
      response: {
        successWhen: { path: 'SMSMessageData.Recipients.0.status', in: ['Success', 'Sent', 'Submitted'] },
        messageIdPath: 'SMSMessageData.Recipients.0.messageId',
        errorCodePath: 'SMSMessageData.Recipients.0.status',
        errorMessagePath: 'SMSMessageData.Message',
      },
      dlr: {
        messageIdPath: 'id',
        statusPath: 'status',
        statusMap: {
          Success: 'delivered',
          Sent: 'sent',
          Submitted: 'sent',
          Buffered: 'sent',
          Rejected: 'failed',
          Failed: 'failed',
        },
        errorCodePath: 'failureReason',
      },
      inbound: { fromPath: 'from', textPath: 'text', messageIdPath: 'id', toPath: 'to', timestampPath: 'date' },
      defaultCountryCode: '+256',
    },
  },
  twilio: {
    label: 'Twilio',
    secrets: ['accountSid', 'basicAuth'],
    config: {
      endpoint: 'https://api.twilio.com/2010-04-01/Accounts/{{secret.accountSid}}/Messages.json',
      method: 'POST',
      bodyEncoding: 'form',
      senderId: '',
      headers: { Authorization: 'Basic {{secret.basicAuth}}' },
      params: { To: '{{to}}', From: '{{from}}', Body: '{{text}}' },
      response: {
        successWhen: { path: 'sid' },
        messageIdPath: 'sid',
        errorCodePath: 'code',
        errorMessagePath: 'message',
      },
      dlr: {
        messageIdPath: 'MessageSid',
        statusPath: 'MessageStatus',
        statusMap: {
          queued: 'sent',
          sent: 'sent',
          delivered: 'delivered',
          undelivered: 'failed',
          failed: 'failed',
        },
        errorCodePath: 'ErrorCode',
      },
      inbound: { fromPath: 'From', textPath: 'Body', messageIdPath: 'MessageSid', toPath: 'To' },
    },
  },
};

/**
 * Absolute callback URL for the gateway's dashboard. Built from the API base so
 * it is right in every deployment shape, with a warning when it is obviously not
 * reachable from the internet — a localhost callback URL pasted into a gateway
 * silently produces a channel that can send but never reports delivery.
 */
function webhookUrl(channelId: string, kind: 'status' | 'inbound'): string {
  const base = getApiBaseUrl();
  const origin = base.startsWith('http') ? '' : window.location.origin;
  return `${origin}${base}/communication/webhooks/sms/${channelId}/${kind}`;
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
      <div className="flex gap-1">
        <input className="input flex-1 font-mono text-xs" readOnly value={value} />
        <button
          className="btn-secondary shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => notify.error('Could not copy to the clipboard.'),
            );
          }}
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function SmsGatewayForm({
  channelId,
  initialConfig,
}: {
  channelId: string;
  /** Sanitized config from the server — `secretsEnc` stripped, secret masked. */
  initialConfig: Record<string, unknown> | undefined;
}) {
  const update = useUpdateChannel();

  const [preset, setPreset] = useState<PresetId>('custom');
  const [config, setConfig] = useState<GatewayConfig>(() => ({
    endpoint: '',
    method: 'POST',
    bodyEncoding: 'form',
    params: {},
    response: {},
    ...(initialConfig as Partial<GatewayConfig>),
  }));
  const [secretsText, setSecretsText] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const configured = !!config.endpoint;
  const localhost = useMemo(() => /localhost|127\.0\.0\.1/.test(webhookUrl(channelId, 'status')), [channelId]);

  function applyPreset(id: PresetId) {
    setPreset(id);
    if (id === 'custom') return;
    const p = PRESETS[id];
    setConfig((c) => ({ ...p.config, senderId: c.senderId || p.config.senderId }));
    setSecretsText(p.secrets.map((k) => `${k}=`).join('\n'));
  }

  /** `key=value` lines → the secrets object. Blank means "keep what is stored". */
  function parseSecrets(): Record<string, string> | undefined {
    const entries = secretsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf('=');
        return i < 0 ? null : ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string]);
      })
      .filter((e): e is [string, string] => !!e && !!e[1]);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function save() {
    // `webhookSecret` comes back masked; sending the mask back would overwrite
    // the real secret with bullets and break every callback.
    const { webhookSecret: _masked, ...rest } = config;
    update.mutate(
      { id: channelId, config: rest as unknown as Record<string, unknown>, secrets: parseSecrets() },
      {
        onSuccess: () => {
          setSecretsText('');
          notify.success('Gateway saved.', 'Credentials were encrypted and are no longer readable here.');
        },
        onError: (err) => notify.error('The gateway config was rejected.', (err as Error).message),
      },
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Gateway</span>
        {(['africastalking', 'twilio', 'custom'] as PresetId[]).map((id) => (
          <button
            key={id}
            className={preset === id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => applyPreset(id)}
          >
            {id === 'custom' ? 'Custom' : PRESETS[id].label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium">Send endpoint</label>
          <input
            className="input font-mono text-xs"
            placeholder="https://api.example.com/v1/send"
            value={config.endpoint}
            onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
          />
          <p className="text-xs text-gray-500">
            Must be https — credentials and parent phone numbers travel in this request.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Sender ID</label>
          <input
            className="input"
            placeholder="SCHOOL"
            value={config.senderId ?? ''}
            onChange={(e) => setConfig({ ...config, senderId: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Default country code</label>
          <input
            className="input"
            placeholder="+256"
            value={config.defaultCountryCode ?? ''}
            onChange={(e) => setConfig({ ...config, defaultCountryCode: e.target.value })}
          />
          <p className="text-xs text-gray-500">Applied to numbers typed as 0772…</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Method</label>
          <select
            className="input"
            value={config.method}
            onChange={(e) => setConfig({ ...config, method: e.target.value as 'POST' | 'GET' })}
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Body encoding</label>
          <select
            className="input"
            value={config.bodyEncoding}
            onChange={(e) =>
              setConfig({ ...config, bodyEncoding: e.target.value as GatewayConfig['bodyEncoding'] })
            }
          >
            <option value="form">form-urlencoded</option>
            <option value="json">JSON</option>
            <option value="query">Query string</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Max segments per message</label>
          <input
            className="input"
            type="number"
            min={0}
            placeholder="0 = no cap"
            value={config.maxSegments ?? ''}
            onChange={(e) =>
              setConfig({ ...config, maxSegments: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Cost per segment (micros)</label>
          <input
            className="input"
            type="number"
            min={0}
            placeholder="e.g. 32000 = 0.032 of a unit"
            value={config.costPerSegmentMicros ?? ''}
            onChange={(e) =>
              setConfig({
                ...config,
                costPerSegmentMicros: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>

        <label className="flex items-start gap-2 text-xs sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!config.transliterate}
            onChange={(e) => setConfig({ ...config, transliterate: e.target.checked })}
          />
          <span>
            <span className="font-medium">Rewrite smart quotes to plain ASCII</span>
            <span className="block text-gray-500">
              A single curly quote pasted from Word forces the whole message to UCS-2 and more than
              halves the per-segment capacity. Accented names are never touched.
            </span>
          </span>
        </label>
      </div>

      {/* Credentials */}
      <div className="space-y-1">
        <label className="flex items-center gap-1 text-xs font-medium">
          <KeyRound className="h-3.5 w-3.5" /> Credentials
        </label>
        <textarea
          className="input h-20 font-mono text-xs"
          placeholder={'apiKey=…\nusername=…'}
          value={secretsText}
          onChange={(e) => setSecretsText(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          One <code>key=value</code> per line, referenced from the request as{' '}
          <code>{'{{secret.key}}'}</code>. Encrypted at rest and never sent back to this screen —
          leave blank to keep the stored values.
        </p>
      </div>

      {/* Raw mappings */}
      <button className="btn-secondary text-xs" onClick={() => setAdvanced((a) => !a)}>
        {advanced ? 'Hide' : 'Show'} request &amp; response mapping
      </button>
      {advanced && (
        <div className="grid gap-2">
          {(['params', 'headers', 'response', 'dlr', 'inbound'] as const).map((key) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium">{key}</label>
              <textarea
                className="input h-24 font-mono text-xs"
                value={JSON.stringify(config[key] ?? (key === 'params' || key === 'headers' ? {} : {}), null, 2)}
                onChange={(e) => {
                  try {
                    setConfig({ ...config, [key]: JSON.parse(e.target.value) });
                  } catch {
                    // Ignore mid-typing parse errors; the server validates on save.
                  }
                }}
              />
            </div>
          ))}
          <p className="text-xs text-gray-500">
            Placeholders: <code>{'{{to}}'}</code> <code>{'{{toLocal}}'}</code> <code>{'{{from}}'}</code>{' '}
            <code>{'{{text}}'}</code> <code>{'{{requestId}}'}</code> <code>{'{{secret.name}}'}</code>
          </p>
        </div>
      )}

      {/* Callbacks */}
      {configured && (
        <div className="space-y-2 rounded-lg border bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-1 text-sm font-medium">
            <Webhook className="h-4 w-4" /> Callback URLs
          </div>
          <p className="text-xs text-gray-500">
            Paste these into the gateway dashboard. Both require the shared secret, sent as the{' '}
            <code>x-sms-webhook-secret</code> header or a <code>secret</code> query parameter — the
            server mints one when the channel is saved.
          </p>
          <CopyField label="Delivery reports (DLR)" value={webhookUrl(channelId, 'status')} />
          <CopyField label="Incoming messages (MO)" value={webhookUrl(channelId, 'inbound')} />
          {localhost && (
            <p className="text-xs text-amber-600">
              This is a localhost URL — a gateway on the internet cannot reach it, so delivery
              reports and replies will never arrive in this environment.
            </p>
          )}
        </div>
      )}

      <button className="btn-primary inline-flex items-center gap-1" onClick={save} disabled={update.isPending}>
        <Save className="h-4 w-4" /> {update.isPending ? 'Saving…' : 'Save gateway'}
      </button>
    </div>
  );
}
