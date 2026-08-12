/**
 * Normalizes a raw Baileys `WAMessage` into the fields InboundMessageService
 * needs. Kept tiny and provider-local so no Baileys shape leaks past the adapter.
 * v1 handles text (conversation / extendedTextMessage); other content types map
 * to a placeholder body so the thread still shows something arrived.
 */
export interface MappedWaMessage {
  id: string;
  remoteJid: string;
  senderJid: string;
  pushName: string | null;
  text: string;
  contentType: string;
  timestamp: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapWaMessage(m: any): MappedWaMessage | null {
  const key = m?.key;
  if (!key?.id || !key?.remoteJid) return null;
  if (key.fromMe) return null; // our own echo
  if (key.remoteJid === 'status@broadcast') return null; // status updates

  const msg = m.message;
  if (!msg) return null;

  const text: string =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    '';

  let contentType = 'text';
  if (msg.imageMessage) contentType = 'image';
  else if (msg.videoMessage) contentType = 'video';
  else if (msg.audioMessage) contentType = 'audio';
  else if (msg.documentMessage) contentType = 'file';
  else if (msg.locationMessage) contentType = 'location';

  // For a non-text type with no caption, synthesize a placeholder so the message
  // is still visible (attachments are out of scope for v1).
  const body = text || (contentType === 'text' ? '' : `[${contentType}]`);
  if (!body) return null;

  const tsRaw = m.messageTimestamp;
  const tsSeconds = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw?.low ?? tsRaw ?? Date.now() / 1000);

  return {
    id: key.id,
    remoteJid: key.remoteJid,
    // In a group, the actual sender is `participant`; in a 1:1 it is the remoteJid.
    senderJid: key.participant ?? key.remoteJid,
    pushName: m.pushName ?? null,
    text: body,
    contentType,
    timestamp: new Date(tsSeconds * 1000),
  };
}

/** `2567...@s.whatsapp.net` → `+2567...`. Returns null for group/broadcast jids. */
export function jidToPhone(jid: string): string | null {
  const at = jid.indexOf('@');
  if (at < 0) return null;
  const domain = jid.slice(at + 1);
  if (domain !== 's.whatsapp.net') return null; // groups (g.us) have no phone
  const digits = jid.slice(0, at).replace(/[^\d]/g, '');
  return digits ? `+${digits}` : null;
}
