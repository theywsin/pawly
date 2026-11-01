import { useSyncExternalStore } from 'react';
import { cn } from './cn.js';

type ToastItem = { id: number; tone: 'success' | 'danger' | 'info'; text: string };
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: ToastItem['tone'] = 'success'): void {
  const id = ++seq;
  items = [...items, { id, tone, text }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 5000);
}

/** Live region announcing toasts to assistive technology. */
export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-md',
            t.tone === 'success' && 'border-success/30 bg-surface text-success',
            t.tone === 'danger' && 'border-danger/30 bg-surface text-danger',
            t.tone === 'info' && 'border-border bg-surface text-text',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
