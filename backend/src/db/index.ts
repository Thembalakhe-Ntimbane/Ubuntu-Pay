import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { config } from '../config';
import * as schema from './schema';

// Use file: scheme so libsql writes to a local SQLite file — no server needed.
const client = createClient({ url: `file:${config.db.path}` });

export const db = drizzle(client, { schema });
