import { config } from 'zod';

// CSP forbids eval; tell zod not to probe for it (its JIT check otherwise logs a CSP violation).
// Imported first in main.tsx so it runs before any schema is used.
config({ jitless: true });
