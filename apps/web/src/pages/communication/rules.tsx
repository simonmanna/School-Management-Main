import { useState } from 'react';
import { Bell, Plus, Trash2, Zap } from 'lucide-react';
import {
  useDeleteRule,
  useEventableEvents,
  useRules,
  useTemplates,
  useToggleRule,
  useUpsertRule,
  useUpsertTemplate,
} from '@/features/communication/api';

/**
 * Phase 2 admin surface — event-driven messaging. Author templates ({{payload}}
 * placeholders) and rules (event → template → recipients → channel). This is the
 * config that turns the ~150 domain events into notifications/messages without
 * code, generalising the old hardcoded approvals→notification subscriber.
 */
export default function CommunicationRulesPage() {
  const { data: templates = [] } = useTemplates();
  const { data: rules = [] } = useRules();
  const { data: events = [] } = useEventableEvents();
  const upsertTemplate = useUpsertTemplate();
  const upsertRule = useUpsertRule();
  const toggleRule = useToggleRule();
  const deleteRule = useDeleteRule();

  const [tpl, setTpl] = useState({ key: '', subject: '', body: '', providerId: '' });
  const [rule, setRule] = useState({
    eventName: '',
    templateKey: '',
    recipientResolver: 'permission:communication:conversation:read',
    channelSelector: 'internal',
    condition: '',
  });

  const saveTemplate = () => {
    if (!tpl.key || !tpl.body) return;
    upsertTemplate.mutate(
      { key: tpl.key, subject: tpl.subject || undefined, body: tpl.body, providerId: tpl.providerId || undefined },
      { onSuccess: () => setTpl({ key: '', subject: '', body: '', providerId: '' }) },
    );
  };

  const saveRule = () => {
    if (!rule.eventName || !rule.templateKey || !rule.recipientResolver) return;
    let condition: Record<string, unknown> | undefined;
    if (rule.condition.trim()) {
      try {
        condition = JSON.parse(rule.condition);
      } catch {
        alert('Condition must be valid JSON');
        return;
      }
    }
    upsertRule.mutate({ ...rule, condition }, { onSuccess: () => setRule({ ...rule, templateKey: '', condition: '' }) });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-amber-500" />
        <h1 className="text-xl font-semibold">Event-driven messaging</h1>
      </header>

      {/* Templates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Templates</h2>
        <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Template key (e.g. low_stock_alert)"
              value={tpl.key}
              onChange={(e) => setTpl({ ...tpl, key: e.target.value })}
            />
            <input
              className="input"
              placeholder="Provider (blank = internal)"
              value={tpl.providerId}
              onChange={(e) => setTpl({ ...tpl, providerId: e.target.value })}
            />
            <input
              className="input sm:col-span-2"
              placeholder="Subject (optional)"
              value={tpl.subject}
              onChange={(e) => setTpl({ ...tpl, subject: e.target.value })}
            />
            <textarea
              className="input sm:col-span-2 font-mono text-sm"
              rows={3}
              placeholder="Body — use {{dotted.path}} placeholders, e.g. Stock low: {{productName}} ({{quantity}})"
              value={tpl.body}
              onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
            />
          </div>
          <button
            className="btn-primary mt-2 inline-flex items-center gap-1"
            onClick={saveTemplate}
            disabled={upsertTemplate.isPending}
          >
            <Plus className="h-4 w-4" /> Save template
          </button>
        </div>
        <ul className="divide-y rounded-lg border dark:divide-gray-700 dark:border-gray-700">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-mono">
                {t.key} <span className="text-gray-400">v{t.version}</span>
                {t.providerId && <span className="ml-2 rounded bg-gray-100 px-1 text-xs dark:bg-gray-700">{t.providerId}</span>}
                {!t.active && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
              </span>
              <span className="max-w-md truncate text-gray-500">{t.body}</span>
            </li>
          ))}
          {templates.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No templates yet.</li>}
        </ul>
      </section>

      {/* Rules */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Rules</h2>
        <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="input"
              value={rule.eventName}
              onChange={(e) => setRule({ ...rule, eventName: e.target.value })}
            >
              <option value="">Select event…</option>
              {events.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Template key"
              value={rule.templateKey}
              onChange={(e) => setRule({ ...rule, templateKey: e.target.value })}
            />
            <input
              className="input"
              placeholder="Recipient (permission:… | role:… | user:path | partner:path)"
              value={rule.recipientResolver}
              onChange={(e) => setRule({ ...rule, recipientResolver: e.target.value })}
            />
            <select
              className="input"
              value={rule.channelSelector}
              onChange={(e) => setRule({ ...rule, channelSelector: e.target.value })}
            >
              <option value="internal">internal (in-app alert)</option>
              <option value="whatsapp">whatsapp</option>
              <option value="telegram">telegram</option>
            </select>
            <input
              className="input sm:col-span-2 font-mono text-sm"
              placeholder='Condition JSON (optional), e.g. {"total":{"$gte":100}}'
              value={rule.condition}
              onChange={(e) => setRule({ ...rule, condition: e.target.value })}
            />
          </div>
          <button
            className="btn-primary mt-2 inline-flex items-center gap-1"
            onClick={saveRule}
            disabled={upsertRule.isPending}
          >
            <Plus className="h-4 w-4" /> Save rule
          </button>
        </div>
        <ul className="divide-y rounded-lg border dark:divide-gray-700 dark:border-gray-700">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Bell className={`h-4 w-4 ${r.enabled ? 'text-green-500' : 'text-gray-300'}`} />
                <span className="font-mono">{r.eventName}</span>
                <span className="text-gray-400">→</span>
                <span>{r.templateKey}</span>
                <span className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-700">{r.channelSelector}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => toggleRule.mutate({ id: r.id, enabled: e.target.checked })}
                  />
                  enabled
                </label>
                <button className="text-red-500 hover:text-red-700" onClick={() => deleteRule.mutate(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {rules.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No rules yet.</li>}
        </ul>
      </section>
    </div>
  );
}
