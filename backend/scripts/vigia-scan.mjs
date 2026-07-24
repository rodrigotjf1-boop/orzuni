#!/usr/bin/env node
/**
 * Orzuni · varredura do vigia — versão STANDALONE (sem NestJS, sem banco).
 *
 * Prova a lógica do vigia de ponta a ponta contra a loja de teste REAL:
 *  1) autentica (client_credentials),
 *  2) puxa catálogo + unsellableItems,
 *  3) compara com o snapshot anterior (arquivo snapshot.json),
 *  4) imprime os alertas com "fora do ar há X" e o motivo.
 *
 * A cada execução ele atualiza snapshot.json — então na 2ª rodada em diante o
 * "desde" passa a valer de verdade. É o mesmo algoritmo de src/vigia/vigia.service.ts,
 * só que persistindo num JSON em vez do Postgres.
 *
 * Uso:
 *   IFOOD_CLIENT_ID=... IFOOD_CLIENT_SECRET=... IFOOD_MERCHANT_ID=... node scripts/vigia-scan.mjs
 * (ou preencha um .env ao lado e rode com --env-file=.env no Node 20+)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.IFOOD_BASE ?? 'https://merchant-api.ifood.com.br';
const CAT = BASE + '/catalog/v2.0';
const SNAP = path.join(DIR, 'snapshot.json');

const CID = process.env.IFOOD_CLIENT_ID;
const SEC = process.env.IFOOD_CLIENT_SECRET;
const MERCHANT = process.env.IFOOD_MERCHANT_ID;
if (!CID || !SEC || !MERCHANT) {
  console.error('faltam IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET / IFOOD_MERCHANT_ID');
  process.exit(1);
}

let token = null;
async function tk() {
  if (token) return token;
  const r = await fetch(`${BASE}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grantType: 'client_credentials', clientId: CID, clientSecret: SEC }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  token = (await r.json()).accessToken;
  return token;
}
async function get(pathname) {
  const r = await fetch(CAT + pathname, { headers: { Authorization: `Bearer ${await tk()}`, Accept: 'application/json' } });
  return r.ok ? r.json() : null;
}

function fmtDur(ms) {
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
}

(async () => {
  const agora = Date.now();
  const prev = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : {};

  const cats = await get(`/merchants/${MERCHANT}/catalogs`);
  const catalog = cats?.[0];
  if (!catalog) { console.error('sem catálogo'); process.exit(1); }

  const categorias = await get(`/merchants/${MERCHANT}/catalogs/${catalog.catalogId}/categories?includeItems=true`);
  const unsell = await get(`/merchants/${MERCHANT}/catalogs/${catalog.catalogId}/unsellableItems`);

  const cascata = new Set();
  for (const c of unsell?.categories ?? [])
    for (const u of c.unsellableItems ?? [])
      if ((u.restrictions ?? []).includes('OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS')) cascata.add(u.id);

  const lista = Array.isArray(categorias) ? categorias : [categorias];
  const snapshot = {};
  const alertas = [];

  for (const c of lista) {
    for (const item of c.items ?? []) {
      const ctx = (item.contextModifiers ?? []).find((m) => m.catalogContext === 'DEFAULT');
      const ext = item.externalCode ?? ctx?.externalCode ?? null;
      const noAr = !cascata.has(item.id) && (ctx?.status ?? item.status) === 'AVAILABLE';
      const p = prev[item.id];
      const desde = !p || p.noAr !== noAr ? agora : p.desde;
      snapshot[item.id] = { noAr, desde, nome: item.name, ext };
      if (!noAr) {
        const motivo = cascata.has(item.id) ? 'cascata' : item.status === 'UNAVAILABLE' ? 'pausa manual' : 'desconhecido';
        alertas.push({ nome: item.name, ext, motivo, desde, grupo: cascata.has(item.id) ? item.optionGroups?.[0]?.name : null });
      }
    }
  }

  fs.writeFileSync(SNAP, JSON.stringify(snapshot, null, 2));
  alertas.sort((a, b) => a.desde - b.desde);

  console.log(`\n📡 Orzuni · vigia — catálogo ${catalog.status}`);
  console.log(`   loja ${MERCHANT.slice(0, 8)} · ${Object.keys(snapshot).length} itens · ${alertas.length} fora do ar\n`);
  if (alertas.length === 0) {
    console.log('   ✓ tudo no ar.');
  } else {
    for (const a of alertas) {
      const primeiraVez = !prev[Object.keys(prev).find((k) => prev[k].ext === a.ext)];
      const tempo = a.desde === agora ? '(recém-detectado nesta 1ª varredura)' : `há ${fmtDur(agora - a.desde)}`;
      console.log(`   🔴 ${a.nome}  ·  ${a.motivo}${a.grupo ? ` (grupo "${a.grupo}")` : ''}`);
      console.log(`      PDV ${a.ext ?? '—'}  ·  fora do ar ${tempo}\n`);
    }
  }
  console.log('   snapshot salvo — rode de novo para o "há quanto tempo" valer.\n');
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
