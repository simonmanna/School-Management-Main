import { toast } from 'sonner';

/**
 * An onward step offered alongside a success message.
 *
 * Most successful actions in the school workflow have an obvious next task —
 * enrol a pupil and you want their record; approve marks and you want the
 * result run. Without this the toast is a full stop and the user has to find
 * the next screen through the nav, which is where the workflow kept breaking.
 */
export type NotifyAction = { label: string; onClick: () => void };

/**
 * Second argument accepts either a plain description (the long-standing shape,
 * used by ~70 call sites) or an options object carrying an action, so adding a
 * CTA to one toast never means touching the others.
 */
type Extra = string | { description?: string; action?: NotifyAction };

const opts = (extra?: Extra) =>
  typeof extra === 'string' || extra === undefined
    ? { description: extra }
    : { description: extra.description, action: extra.action };

export const notify = {
  success: (message: string, extra?: Extra) => toast.success(message, opts(extra)),
  error: (message: string, extra?: Extra) => toast.error(message, opts(extra)),
  info: (message: string, extra?: Extra) => toast.info(message, opts(extra)),
  warning: (message: string, extra?: Extra) => toast.warning(message, opts(extra)),
  loading: (message: string) => toast.loading(message),
  promise: <T,>(promise: Promise<T>, messages: { loading: string; success: string; error: string }) =>
    toast.promise(promise, messages),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
