import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  owner: text('owner').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
});

export * from './schema-authz';

