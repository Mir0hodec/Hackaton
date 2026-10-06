import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('records',{id:text('id').primaryKey(),kind:text('kind').notNull(),data:text('data').notNull(),version:integer('version').notNull().default(0)},t=>[index('records_kind').on(t.kind)]);
export const sessions=sqliteTable('sessions',{id:text('id').primaryKey(),userId:text('user_id').notNull(),expires:integer('expires').notNull()});
export const photos=sqliteTable('photos',{id:text('id').primaryKey(),userId:text('user_id').notNull(),hash:text('hash').notNull(),created:integer('created').notNull(),type:text('type').notNull()},t=>[index('photos_hash').on(t.hash)]);
