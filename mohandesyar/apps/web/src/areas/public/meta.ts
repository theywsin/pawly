import { useEffect } from 'react';

export interface PageMeta {
  title: string;
  description: string;
}

export const SITE_NAME = 'مهندس‌یار';

export function fullTitle(title: string): string {
  return title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
}

/** Client-side title/description; the prerender step writes the same values into the static HTML. */
export function usePageMeta(meta: PageMeta): void {
  useEffect(() => {
    document.title = fullTitle(meta.title);
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }, [meta.title, meta.description]);
}
