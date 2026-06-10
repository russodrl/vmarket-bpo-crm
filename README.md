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

Ele cria:

- perfis e roles
- parceiros BPO
- empresas
- contatos
- negócios
- atividades
- campos customizados
- histórico
- RLS para Admin VMarket e BPO parceiro
- dados mockados iniciais

## Roles

- `admin_vmarket`: vê tudo.
- `bpo_partner`: vê apenas os registros vinculados ao seu `bpo_id` ou usuário.
