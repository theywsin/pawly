import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@mohandesyar/module-sdk/web';

/** Maps server-side validation details (path → message) onto form fields; returns the general message. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details) ? (err.details as { path: string; message: string }[]) : [];
    for (const d of details) if (d.path) setError(d.path as Path<T>, { message: d.message });
    return err.message;
  }
  return 'خطای پیش‌بینی‌نشده رخ داد';
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'خطای پیش‌بینی‌نشده رخ داد';
}
