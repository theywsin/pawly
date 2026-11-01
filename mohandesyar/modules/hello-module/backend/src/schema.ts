import { pgTable, text } from 'drizzle-orm/pg-core';
import { companyScopedColumns, companyScopedPolicies } from '@mohandesyar/module-sdk/db';

/** Mirrors migrations/0001_notes.sql (the SQL is the source of truth for the installer). */
export const notes = pgTable(
  'hello_module_notes',
  {
    ...companyScopedColumns(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
  },
  () => companyScopedPolicies(),
);

export type Note = typeof notes.$inferSelect;
