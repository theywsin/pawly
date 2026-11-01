import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

export interface UploadedImage {
  id: string;
  url: string;
}

/** Uploads one image to the site media library (PNG, JPEG, WebP or GIF up to 5 MB). */
export async function uploadImage(file: File, alt = ''): Promise<UploadedImage> {
  const fd = new FormData();
  fd.append('alt', alt);
  fd.append('file', file);
  return consoleApi<UploadedImage>('/api/console/site/media', { method: 'POST', raw: fd });
}

export function ImageUpload({ value, onChange, label = 'بارگذاری تصویر', previewClass = 'h-20' }: { value: string | null; onChange(img: UploadedImage): void; label?: string; previewClass?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {value && <img src={value} alt="" className={`${previewClass} w-auto rounded border border-border bg-white object-contain p-1`} />}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            onChange(await uploadImage(f));
          } catch (err) {
            toast(errorMessage(err), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
        <ImagePlus className="size-4" /> {value ? 'تغییر تصویر' : label}
      </Button>
    </div>
  );
}
