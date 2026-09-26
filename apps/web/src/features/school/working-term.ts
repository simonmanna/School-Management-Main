import { useCallback, useEffect, useState } from 'react';
import { useTerms } from './api';

const KEY = 'school.workingTermId';

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The term a member of staff is working in, remembered between screens (P4).
 * Results, promotion and class lists each asked for the term again; this
 * carries the last choice, falling back to the school's current term. It is a
 * per-browser convenience only — every request still names its term.
 */
export function useWorkingTerm(): [string, (termId: string) => void] {
  const { data: terms } = useTerms();
  const [termId, setTermIdState] = useState<string>(read);

  useEffect(() => {
    const list = terms?.data ?? [];
    if (!list.length) return;
    if (termId && list.some((t) => t.id === termId)) return;
    const current = list.find((t) => t.isCurrent)?.id ?? '';
    if (current) setTermIdState(current);
  }, [terms?.data, termId]);

  const setTermId = useCallback((id: string) => {
    setTermIdState(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
    } catch {
      /* storage unavailable: the choice lasts for this screen only */
    }
  }, []);

  return [termId, setTermId];
}
