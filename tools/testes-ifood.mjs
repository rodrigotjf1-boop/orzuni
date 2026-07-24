#!/usr/bin/env node
/**
 * Orzuni — bancada de testes da Catalog API v2 do iFood (loja de TESTE).
 *
 * Uso:
 *   1) criar um arquivo `.env` ao lado deste script:
 *        IFOOD_CLIENT_ID=...
 *        IFOOD_CLIENT_SECRET=...
 *        IFOOD_MERCHANT_ID=...        (opcional — o passo `merchants` descobre)
 *   2) node testes-ifood.mjs <comando> [args]
 *
 * Comandos de LEITURA (seguros, não alteram nada):
 *   token | merchants | version | catalogs | categories | sellable | unsellable
 *   produtos | grupos | item <itemId> | produto-ext <externalCode> | batch <batchId>
 *
 * Comandos de ESCRITA (exigem --write; só na loja de teste):
 *   pausar <itemId> [--ctx DEFAULT] | ativar <itemId> [--ctx DEFAULT]
 *   preco <itemId> <valor> [--ctx DEFAULT]
 *   preco-ext <externalCode> <valor>        <- prova o MODO PONTE (sem id do iFood)
 *   pausar-opcao <optionId>                 <- prova a CASCATA (item pai cai?)
 *   criar-categoria <nome>
 *   criar-item <categoryId> <nome> <preco>  <- prova se o item.id enviado é ignorado
 *   upload-imagem <arquivo>                 <- descobre o schema (lacuna aberta)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const AUTH = 'https://merchant-api.ifood.com.br/authentication/v1.0'
const MERCHANT = 'https://merchant-api.ifood.com.br/merchant/v1.0'
const CATALOG = 'https://merchant-api.ifood.com.br/catalog/v2.0'

// ---------- config ----------
const envFile = path.join(DIR, '.env')
if (fs.existsSync(envFile)) {
  for (const linha of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
  }
}
const CLIENT_ID = process.env.IFOOD_CLIENT_ID
const CLIENT_SECRET = process.env.IFOOD_CLIENT_SECRET
let MERCHANT_ID = process.env.IFOOD_MERCHANT_ID

const args = process.argv.slice(2)
const cmd = args[0]
const ESCRITA = args.includes('--write')
const ctx = (() => {
  const i = args.indexOf('--ctx')
  return i >= 0 ? args[i + 1] : null
})()
const pos = args.slice(1).filter((a) => !a.startsWith('--') && a !== ctx)

// ---------- infra ----------
let token = null
async function getToken() {
  if (token) return token
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('faltam IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET')
  const res = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(`token ${res.status}: ${JSON.stringify(j)}`)
  token = j.accessToken
  return token
}

// Mostra o payload do JWT — confirma os ESCOPOS (claim `aud`) do app.
function escopos(tk) {
  try {
    const p = JSON.parse(Buffer.from(tk.split('.')[1], 'base64').toString())
    return { aud: p.aud, exp: new Date(p.exp * 1000).toISOString() }
  } catch {
    return null
  }
}

async function api(metodo, url, body) {
  const tk = await getToken()
  const t0 = Date.now()
  const res = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${tk}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const texto = await res.text()
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = texto
  }
  console.log(`\n${metodo} ${url.replace(CATALOG, '')} → ${res.status} (${Date.now() - t0}ms)`)
  // headers de rate limit, se o iFood mandar — importante pro throttle global
  for (const [k, v] of res.headers) if (/ratelimit|retry-after/i.test(k)) console.log(`  ${k}: ${v}`)
  if (!res.ok) console.log('  ERRO:', typeof dados === 'string' ? dados.slice(0, 400) : JSON.stringify(dados, null, 2))
  return { ok: res.ok, status: res.status, dados }
}

async function precisaMerchant() {
  if (MERCHANT_ID) return MERCHANT_ID
  const { dados } = await api('GET', `${MERCHANT}/merchants`)
  MERCHANT_ID = dados?.[0]?.id
  if (!MERCHANT_ID) throw new Error('nenhum merchant autorizado para este app')
  console.log(`  merchantId detectado: ${MERCHANT_ID}`)
  return MERCHANT_ID
}

function exigeEscrita() {
  if (!ESCRITA) {
    console.log('\n⚠️  comando de ESCRITA. Repita com --write para confirmar (use só na loja de teste).')
    process.exit(1)
  }
}

const uuid = () => crypto.randomUUID()
const dump = (x) => console.log(JSON.stringify(x, null, 2))

// ---------- comandos ----------
const comandos = {
  // T0 — autenticação + escopos do app
  async token() {
    const tk = await getToken()
    console.log('accessToken OK (6h).')
    dump(escopos(tk))
  },

  // T1 — lojas que autorizaram o app
  async merchants() {
    const { dados } = await api('GET', `${MERCHANT}/merchants`)
    dump(dados)
  },

  // T2 — v1 ou v2? (se v1, nada do resto funciona)
  async version() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/catalog/version`)
    dump(dados)
  },

  // T3 — catalogId, groupId, contextos, modifiedAt (guarda de concorrência)
  async catalogs() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/catalogs`)
    dump(dados)
  },

  // T4 — o dump do cardápio: é isto que a interface do Orzuni vai renderizar
  async categories() {
    const m = await precisaMerchant()
    const { dados: cats } = await api('GET', `${CATALOG}/merchants/${m}/catalogs`)
    const catalogId = cats?.[0]?.catalogId
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/catalogs/${catalogId}/categories?includeItems=true`)
    const lista = Array.isArray(dados) ? dados : [dados]
    for (const c of lista) {
      console.log(`\n▸ ${c.name} [${c.status}] template=${c.template} (${c.items?.length ?? 0} itens)`)
      for (const i of c.items ?? []) {
        console.log(
          `   ${i.status === 'AVAILABLE' ? '🟢' : '🔴'} ${i.name} · R$ ${i.price?.value} · PDV=${i.externalCode || '—'} · id=${i.id}`,
        )
      }
    }
    fs.writeFileSync(path.join(DIR, 'cardapio.json'), JSON.stringify(dados, null, 2))
    console.log('\n(salvo em cardapio.json)')
  },

  // T5 — visão "como o cliente vê" (usa groupId, não catalogId)
  async sellable() {
    const m = await precisaMerchant()
    const { dados: cats } = await api('GET', `${CATALOG}/merchants/${m}/catalogs`)
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/catalogs/${cats?.[0]?.groupId}/sellableItems`)
    console.log(`itens vendáveis: ${Array.isArray(dados) ? dados.length : '?'}`)
  },

  // T6 ⭐ — o coração do Orzuni: o que está fora do ar e POR QUÊ
  async unsellable() {
    const m = await precisaMerchant()
    const { dados: cats } = await api('GET', `${CATALOG}/merchants/${m}/catalogs`)
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/catalogs/${cats?.[0]?.catalogId}/unsellableItems`)
    dump(dados)
  },

  async produtos() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/products?limit=200&page=1`)
    console.log(`produtos: ${Array.isArray(dados) ? dados.length : '?'}`)
    dump(Array.isArray(dados) ? dados.slice(0, 3) : dados)
  },

  async grupos() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/optionGroups?includeOptions=true`)
    dump(dados)
  },

  async item() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/items/${pos[0]}/flat`)
    dump(dados)
  },

  async ['produto-ext']() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/products/externalCode/${pos[0]}`)
    dump(dados)
  },

  async batch() {
    const m = await precisaMerchant()
    const { dados } = await api('GET', `${CATALOG}/merchants/${m}/batch/${pos[0]}`)
    dump(dados)
  },

  // T7/T8 — pausa e reativação (o evento mais usado da operação)
  async pausar() {
    exigeEscrita()
    const m = await precisaMerchant()
    const body = ctx
      ? { itemId: pos[0], statusByCatalog: [{ status: 'UNAVAILABLE', catalogContext: ctx }] }
      : { itemId: pos[0], status: 'UNAVAILABLE' }
    dump((await api('PATCH', `${CATALOG}/merchants/${m}/items/status`, body)).dados)
  },

  async ativar() {
    exigeEscrita()
    const m = await precisaMerchant()
    const body = ctx
      ? { itemId: pos[0], statusByCatalog: [{ status: 'AVAILABLE', catalogContext: ctx }] }
      : { itemId: pos[0], status: 'AVAILABLE' }
    dump((await api('PATCH', `${CATALOG}/merchants/${m}/items/status`, body)).dados)
  },

  // T9 — preço por item, com e sem contexto
  async preco() {
    exigeEscrita()
    const m = await precisaMerchant()
    const valor = Number(pos[1])
    const body = ctx
      ? { itemId: pos[0], priceByCatalog: [{ value: valor, catalogContext: ctx }] }
      : { itemId: pos[0], price: { value: valor } }
    dump((await api('PATCH', `${CATALOG}/merchants/${m}/items/price`, body)).dados)
  },

  // T10 ⭐ — MODO PONTE: repreçar só pelo código de PDV, sem conhecer id do iFood
  async ['preco-ext']() {
    exigeEscrita()
    const m = await precisaMerchant()
    const url = `${CATALOG}/merchants/${m}/products/price${ctx ? `?catalogContext=${ctx}` : ''}`
    const r = await api('PATCH', url, [{ externalCode: pos[0], price: { value: Number(pos[1]) } }])
    dump(r.dados)
    if (r.dados?.batchId) console.log(`\n→ acompanhe: node testes-ifood.mjs batch ${r.dados.batchId}`)
  },

  // T16 ⭐ — a CASCATA: pausar um complemento derruba o item pai?
  async ['pausar-opcao']() {
    exigeEscrita()
    const m = await precisaMerchant()
    dump((await api('PATCH', `${CATALOG}/merchants/${m}/options/status`, { optionId: pos[0], status: 'UNAVAILABLE' })).dados)
    console.log('\n→ agora rode `unsellable` e veja se o item pai aparece com restrictions[]')
  },

  async ['criar-categoria']() {
    exigeEscrita()
    const m = await precisaMerchant()
    const { dados: cats } = await api('GET', `${CATALOG}/merchants/${m}/catalogs`)
    const body = { name: pos[0], status: 'AVAILABLE', template: 'DEFAULT', index: 99, externalCode: `ORZ-CAT-${Date.now()}` }
    dump((await api('POST', `${CATALOG}/merchants/${m}/catalogs/${cats?.[0]?.catalogId}/categories`, body)).dados)
  },

  // T13/T14 ⭐ — o item.id enviado é respeitado ou ignorado? rodar 2x e comparar.
  async ['criar-item']() {
    exigeEscrita()
    const m = await precisaMerchant()
    const itemId = uuid()
    const productId = uuid()
    const externalCode = `ORZ-${pos[1].toUpperCase().replace(/\W+/g, '-')}`
    console.log(`enviando item.id=${itemId} · externalCode=${externalCode}`)
    const body = {
      item: {
        id: itemId,
        type: 'DEFAULT',
        categoryId: pos[0],
        productId,
        status: 'AVAILABLE',
        externalCode,
        price: { value: Number(pos[2]) },
        index: 1,
      },
      products: [{ id: productId, name: pos[1], externalCode }],
      optionGroups: [],
      options: [],
    }
    const r = await api('PUT', `${CATALOG}/merchants/${m}/items`, body)
    const devolvido = r.dados?.item?.id
    console.log(`\n>>> id enviado:   ${itemId}`)
    console.log(`>>> id devolvido: ${devolvido}`)
    console.log(devolvido === itemId ? '✅ o iFood RESPEITOU o id' : '⚠️  o iFood IGNOROU o id (reconciliar por externalCode)')
  },

  // T15 — lacuna aberta: descobrir o schema do upload
  async ['upload-imagem']() {
    exigeEscrita()
    const m = await precisaMerchant()
    const b64 = fs.readFileSync(pos[0]).toString('base64')
    for (const tentativa of [{ image: b64 }, { image: `data:image/jpeg;base64,${b64}` }]) {
      const r = await api('POST', `${CATALOG}/merchants/${m}/image/upload`, tentativa)
      if (r.ok) return dump(r.dados)
    }
    console.log('nenhuma variação aceita — provável multipart; testar manualmente')
  },
}

const fn = comandos[cmd]
if (!fn) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''))
  process.exit(cmd ? 1 : 0)
}
fn().catch((e) => {
  console.error('\n✖', e.message)
  process.exit(1)
})
