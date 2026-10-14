import { useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './button.js';
import { Input } from './form.js';

export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content dir="rtl" className="fixed start-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-y-1/2 translate-x-1/2 rounded-lg border border-border bg-surface p-6 shadow-lg focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-lg font-bold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm leading-7 text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-surface-2" aria-label="بستن">
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * Explicit confirmation for destructive operations (docs/06). With `confirmText`, the user must type
 * it exactly (used for uninstall/purge).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'تأیید',
  tone = 'danger',
  confirmText,
  extra,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  confirmText?: string;
  extra?: ReactNode;
  loading?: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !confirmText || typed === confirmText;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!ok} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {extra}
      {confirmText && (
        <label className="mt-2 block text-sm">
          برای تأیید، <code dir="ltr" className="rounded bg-surface-2 px-1">{confirmText}</code> را تایپ کنید:
          <Input dir="ltr" className="mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      )}
    </Dialog>
  );
}
