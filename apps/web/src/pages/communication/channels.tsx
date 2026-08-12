import { useCallback, useState } from 'react';
import { Plug, PlugZap, Plus, Radio, RefreshCw, Trash2, X } from 'lucide-react';
import {
  useChannels,
  useConnectChannel,
  useCreateChannel,
  useDeleteChannel,
  useDisconnectChannel,
  type CommunicationChannel,
} from '@/features/communication/api';
import { useChannelStatusStream, type ChannelStatusEvent } from '@/features/communication/sse';

const STATUS_COLOR: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-amber-500',
  pairing: 'bg-amber-500',
  disconnected: 'bg-gray-400',
  logged_out: 'bg-red-500',
  error: 'bg-red-500',
};

/**
 * Channels + operations dashboard (Phase 3/6). Create provider accounts, link a
 * WhatsApp number (QR pushed over SSE, rendered server-side), and monitor live
 * health: status, pairing date, lease ownership ("no worker owns this session" is
 * distinct from "disconnected"), and daily send consumption.
 */
export default function CommunicationChannelsPage() {
  const { data: channels = [], refetch } = useChannels();
  const create = useCreateChannel();
  const connect = useConnectChannel();
  const disconnect = useDisconnectChannel();
  const del = useDeleteChannel();

  const [form, setForm] = useState({ providerId: 'whatsapp', name: '', config: '' });
  const [qr, setQr] = useState<{ channelId: string; png?: string; status: string } | null>(null);

  const onStatus = useCallback(
    (e: ChannelStatusEvent) => {
      setQr((prev) => {
        if (!prev || prev.channelId !== e.channelId) return prev;
        if (e.status === 'connected') return null; // linked — close modal
        return { ...prev, png: e.qrPngDataUrl ?? prev.png, status: e.status };
      });
    },
    [],
  );
  useChannelStatusStream(onStatus);

  const submitCreate = () => {
    if (!form.name) return;
    let config: Record<string, unknown> | undefined;
    if (form.config.trim()) {
      try {
        config = JSON.parse(form.config);
      } catch {
        alert('Config must be valid JSON');
        return;
      }
    }
    create.mutate(
      { providerId: form.providerId, name: form.name, config },
      { onSuccess: () => setForm({ providerId: 'whatsapp', name: '', config: '' }) },
    );
  };

  const startConnect = (c: CommunicationChannel) => {
    connect.mutate(c.id);
    // WhatsApp/Baileys needs a QR scan — open the modal and wait for SSE.
    if (c.providerId === 'whatsapp' && c.transport === 'baileys') {
      setQr({ channelId: c.id, status: 'connecting' });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-indigo-500" />
          <h1 className="text-xl font-semibold">Communication channels</h1>
        </div>
        <button className="btn-secondary inline-flex items-center gap-1" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* Create */}
      <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-2 sm:grid-cols-3">
          <select className="input" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
          </select>
          <input
            className="input"
            placeholder="Channel name (e.g. WhatsApp Support)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <button className="btn-primary inline-flex items-center justify-center gap-1" onClick={submitCreate} disabled={create.isPending}>
            <Plus className="h-4 w-4" /> Add
          </button>
          <input
            className="input font-mono text-xs sm:col-span-3"
            placeholder={
              form.providerId === 'telegram'
                ? 'Config JSON (optional): {"botToken":"...","webhookSecret":"..."}'
                : 'Config JSON (Cloud transport): {"phoneNumberId":"...","accessToken":"..."}'
            }
            value={form.config}
            onChange={(e) => setForm({ ...form, config: e.target.value })}
          />
        </div>
      </div>

      {/* List */}
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-lg border bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[c.status] ?? 'bg-gray-400'}`} />
              <div>
                <div className="font-medium">
                  {c.name} <span className="text-xs text-gray-400">({c.providerId}/{c.transport})</span>
                </div>
                <div className="text-xs text-gray-500">
                  {c.status}
                  {!c.providerEnabled && <span className="ml-2 text-red-500">provider disabled on server</span>}
                  {c.providerId === 'whatsapp' && c.health && !c.health.ownedByThisProcess && c.status === 'connected' && (
                    <span className="ml-2 text-amber-600">no worker owns this session</span>
                  )}
                  {c.lastError && <span className="ml-2 text-red-500">· {c.lastError}</span>}
                  {c.dailySentCount > 0 && <span className="ml-2">· {c.dailySentCount} sent today</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.status === 'connected' || c.status === 'connecting' || c.status === 'pairing' ? (
                <button
                  className="btn-secondary inline-flex items-center gap-1"
                  onClick={() => disconnect.mutate({ id: c.id, logout: c.providerId === 'whatsapp' })}
                >
                  <Plug className="h-4 w-4" /> Disconnect
                </button>
              ) : (
                <button className="btn-primary inline-flex items-center gap-1" onClick={() => startConnect(c)}>
                  <PlugZap className="h-4 w-4" /> Connect
                </button>
              )}
              <button className="text-red-500 hover:text-red-700" onClick={() => del.mutate(c.id)} title="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {channels.length === 0 && (
          <li className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-700">
            No channels yet. Add a WhatsApp or Telegram channel above.
          </li>
        )}
      </ul>

      {/* QR pairing modal */}
      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setQr(null)}>
          <div className="relative rounded-lg bg-white p-6 text-center dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-3 text-gray-400" onClick={() => setQr(null)}>
              <X className="h-5 w-5" />
            </button>
            <h3 className="mb-3 font-semibold">Link WhatsApp</h3>
            {qr.png ? (
              <img src={qr.png} alt="WhatsApp pairing QR" className="mx-auto h-64 w-64" />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center text-sm text-gray-400">
                Waiting for QR… ({qr.status})
              </div>
            )}
            <p className="mt-3 max-w-xs text-xs text-gray-500">
              WhatsApp → Settings → Linked devices → Link a device, then scan this code. It refreshes automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
