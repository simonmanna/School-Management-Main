/**
 * Lazy loader for the experimental Baileys dependency.
 *
 * The specifier is a widened `string` (not a literal) on purpose: it stops the
 * TypeScript compiler from statically resolving `@whiskeysockets/baileys`, so the
 * package does NOT need to be installed for the API to typecheck or to boot.
 * The import runs only when a Baileys channel is actually connected — with the
 * `ENABLE_COMMUNICATION_WHATSAPP` flag off, the library is never loaded and
 * cannot slow boot or crash the process.
 *
 * Everything from Baileys is typed `any` here; it never crosses the
 * MessagingProvider boundary, so no Baileys type leaks into the domain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Baileys = any;

const PKG: string = '@whiskeysockets/baileys';

let cached: Promise<Baileys> | null = null;

export function loadBaileys(): Promise<Baileys> {
  if (!cached) {
    cached = import(/* @vite-ignore */ PKG).catch((err) => {
      cached = null;
      throw new Error(
        `The '@whiskeysockets/baileys' package is not installed. Install it to use the experimental ` +
          `WhatsApp transport, or set WHATSAPP_TRANSPORT=cloud. (${String(err)})`,
      );
    });
  }
  return cached;
}
