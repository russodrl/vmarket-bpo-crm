# VMarket BPO CRM

CRM para o programa BPO da VMarket, com frontend React + TypeScript + Supabase.

## Produção

https://russodrl.github.io/vmarket-bpo-crm/

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase Auth
- Supabase Postgres + RLS

## Configuração local

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Instale e rode:

```bash
npm install
npm run dev
```

## Supabase

O schema inicial está em:

```text
supabase/migrations/202606100001_vmarket_bpo_crm.sql
```

A camada de integração direta com Pipedrive está em:

```text
supabase/migrations/202606220001_pipedrive_direct_integration.sql
supabase/functions/pipedrive-sync/index.ts
docs/pipedrive-direct-api.md
```

A decisão atual é usar API direta como caminho principal:

```text
Pipedrive Webhooks/API → Supabase Edge Function → Supabase Postgres → CRM VMarket
CRM VMarket → Supabase Edge Function → Pipedrive API
```

Make fica apenas como automação auxiliar, documentado em `docs/make-pipedrive-api.md`.

A automação direta dos formulários Tally do programa BPO para CRM BPO e Pipedrive está documentada em:

```text
docs/tally-bpo-direct-automation.md
```

O schema cria:

- perfis e roles
- parceiros BPO
- empresas
- contatos
- negócios
- atividades
- campos customizados
- histórico
- RLS para Admin VMarket e BPO parceiro
- integração Pipedrive direta: external_integrations, external_records, external_field_mappings, integration_events, integration_logs
- dados mockados iniciais

## Roles

- `admin_vmarket`: vê tudo.
- `bpo_partner`: vê apenas os registros vinculados ao seu `bpo_id` ou usuário.
