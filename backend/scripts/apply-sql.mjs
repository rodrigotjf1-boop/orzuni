#!/usr/bin/env node
/**
 * Aplica um arquivo .sql no Postgres do DATABASE_URL.
 *   node --env-file=.env scripts/apply-sql.mjs database/001_init.sql
 * SSL ligado automaticamente para hosts Supabase.
 */
import fs from 'node:fs';
import pg from 'pg';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('uso: node scripts/apply-sql.mjs <arquivo.sql>');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ausente');
  process.exit(1);
}
const ssl = /supabase|amazonaws|render|neon/.test(url) ? { rejectUnauthorized: false } : undefined;
const sql = fs.readFileSync(arquivo, 'utf8');

const client = new pg.Client({ connectionString: url, ssl });
try {
  await client.connect();
  await client.query(sql);
  console.log(`✓ aplicado: ${arquivo}`);
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
} finally {
  await client.end();
}
