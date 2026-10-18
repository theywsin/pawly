/** Product identity: the only place the product name and logo are defined in the web app. */
export const BRAND_NAME = 'مهندیکس';
export const BRAND_LATIN = 'Mohandix';

/** Logo + name, used in every header (public site, auth, company app). */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <img src="/brand/logo-64.png" width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />
      <span>{BRAND_NAME}</span>
    </span>
  );
}
