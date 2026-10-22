import pg from 'pg';
import { DefaultAzureCredential } from '@azure/identity';
import { createApi } from './app.mjs';
import { readFile } from 'node:fs/promises';
import { createService } from './service.mjs';
import { authenticate } from './auth.mjs';
import { verifyDatabase } from './verify-database.mjs';

for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
  if (!process.env[key]) throw new Error(`Missing required setting: ${key}`);
}
const credential = new DefaultAzureCredential();
const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD || (async () => {
    const token = await credential.getToken('https://ossrdbms-aad.database.windows.net/.default');
    return token.token;
  }),
  ssl: { rejectUnauthorized: true },
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 5000,
  query_timeout: 6000,
});
pool.on('error', () => console.error('HR database pool connection error'));
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
if(process.env.HR_VERIFY_DATABASE==='true')await verifyDatabase(pool);
const server = createApi({ query: sql => pool.query(sql), service:createService(pool), authenticate, allowedOrigin: process.env.FRONTEND_ORIGIN });
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
}
