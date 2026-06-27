/** Tracks grant queue badge state across quote → consent → status. */

const PENDING_KEY = 'ubuntupay_pending_grants';
const DONE_KEY    = 'ubuntupay_done_grants';

type DoneLabel = 'IN ESCROW' | 'COLLECTED';

interface PendingGrant {
  grantId:   string;
  doneLabel: DoneLabel;
}

function readPending(): Record<string, PendingGrant> {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, PendingGrant>;
  } catch {
    return {};
  }
}

function readDone(): Record<string, DoneLabel> {
  try {
    return JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<string, DoneLabel>;
  } catch {
    return {};
  }
}

export function trackPendingGrant(transactionId: string, grantId: string, doneLabel: DoneLabel): void {
  const pending = readPending();
  pending[transactionId] = { grantId, doneLabel };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function finalizeGrant(transactionId: string): void {
  const pending = readPending();
  const entry   = pending[transactionId];
  if (!entry) return;

  const done = readDone();
  done[entry.grantId] = entry.doneLabel;
  sessionStorage.setItem(DONE_KEY, JSON.stringify(done));

  delete pending[transactionId];
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function clearPendingGrant(transactionId: string): void {
  const pending = readPending();
  if (!pending[transactionId]) return;
  delete pending[transactionId];
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function applyGrantBadges(container: HTMLElement): void {
  const done = readDone();
  for (const [grantId, label] of Object.entries(done)) {
    const el = container.querySelector<HTMLElement>(`#status-${grantId}`);
    if (!el) continue;
    el.textContent = label;
    el.classList.remove('pending');
    el.classList.add('collected');
  }
}
