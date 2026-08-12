declare module 'web-push' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string | null,
    options?: { TTL?: number; headers?: Record<string, string> },
  ): Promise<void>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
