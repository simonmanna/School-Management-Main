import type { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import type { CommSecretService } from '../comm-secret.service';
import { loadBaileys, type Baileys } from './baileys-lib';

/**
 * A Baileys `AuthenticationState` backed by Postgres (`WhatsAppAuthState`),
 * AES-256-GCM encrypted per row. Replaces `useMultiFileAuthState`, which is wrong
 * here: the API container FS is ephemeral, and a shared volume would let a second
 * replica fight over creds files — defeating the single-writer lease.
 *
 * `BufferJSON.replacer/reviver` is mandatory (creds are full of Buffers that
 * plain JSON.stringify mangles), and `app-state-sync-key` values must be
 * re-hydrated via `AppStateSyncKeyData.fromObject` or history sync breaks.
 */
export async function useDbAuthState(
  prisma: PrismaService,
  secret: CommSecretService,
  organizationId: string,
  channelId: string,
): Promise<{ state: Baileys; saveCreds: () => Promise<void> }> {
  const baileys = await loadBaileys();
  const { BufferJSON, initAuthCreds, proto } = baileys;

  const read = async (keyType: string, keyId: string): Promise<unknown> => {
    const row = await prisma.raw.whatsAppAuthState.findUnique({
      where: { channelId_keyType_keyId: { channelId, keyType, keyId } },
    });
    if (!row) return null;
    return JSON.parse(secret.decrypt(row.valueEnc), BufferJSON.reviver);
  };

  const write = async (keyType: string, keyId: string, value: unknown): Promise<void> => {
    const valueEnc = secret.encrypt(JSON.stringify(value, BufferJSON.replacer));
    await prisma.raw.whatsAppAuthState.upsert({
      where: { channelId_keyType_keyId: { channelId, keyType, keyId } },
      create: { organizationId, channelId, keyType, keyId, valueEnc },
      update: { valueEnc },
    });
  };

  const del = async (keyType: string, keyId: string): Promise<void> => {
    await prisma.raw.whatsAppAuthState.deleteMany({ where: { channelId, keyType, keyId } });
  };

  const creds = ((await read('creds', '')) as Record<string, unknown> | null) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            let value = await read(type, id);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value) out[id] = value;
          }
          return out;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type] ?? {})) {
              const value = data[type][id];
              if (value) await write(type, id, value);
              else await del(type, id);
            }
          }
        },
      },
    },
    saveCreds: () => write('creds', '', creds),
  };
}
