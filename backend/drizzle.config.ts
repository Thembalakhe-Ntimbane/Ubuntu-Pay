import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Read DB_PATH from the same place the app does (see src/config.ts) so
// `npm run db:push` always targets the file the running server will open.
const dbPath = process.env.DB_PATH ?? './openremit.db';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${dbPath}`,
  },
});
