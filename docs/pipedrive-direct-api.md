# Integração direta Pipedrive ↔ CRM BPO VMarket

## Decisão técnica

O caminho principal passa a ser API direta:

```text
Pipedrive Webhooks/API → Supabase Edge Function → Supabase Postgres → CRM VMarket
CRM VMarket → Supabase Edge Function → Pipedrive API
```

O Make deixa de ser o núcleo da sincronização. Ele pode continuar sendo usado para automações laterais, como WhatsApp, email, PDF, notificações e tarefas.

## Por que não Make como núcleo

- O CRM precisa controlar IDs, mapeamento de campos, logs e reprocessamento.
- O Pipedrive usa chaves próprias para campos customizados.
- Um cenário Make muito grande fica difícil de versionar, revisar e debugar.
- A API direta permite sincronização bidirecional consistente.

## Arquivos adicionados

```text
supabase/migrations/202606220001_pipedrive_direct_integration.sql
supabase/functions/pipedrive-sync/index.ts
docs/pipedrive-direct-api.md
```

## Novas tabelas

### external_integrations

Configura integrações externas. Primeiro registro sugerido:

```text
provider: pipedrive
name: Pipedrive principal
status: active
base_url: https://api.pipedrive.com/v1
```

### external_records

Liga IDs internos do CRM aos IDs externos do Pipedrive.

Exemplo:

```text
entity: deal
internal_id: deals.id
external_id: PIPEDRIVE_DEAL_ID
provider: pipedrive
```

### external_field_mappings

Mapeia campos do CRM para campos do Pipedrive.

Pode mapear campo nativo:

```text
crm_field: value
provider_field_key: value
```

Ou campo configurável:

```text
custom_field_id: custom_fields.id
provider_field_key: chave_customizada_do_pipedrive
```

Direções:

- `inbound`, Pipedrive → CRM
- `outbound`, CRM → Pipedrive
- `bidirectional`, dois sentidos

### integration_events

Log estruturado de eventos recebidos/enviados.

### integration_logs

Logs técnicos ligados aos eventos.

## Supabase Edge Function

Função:

```text
pipedrive-sync
```

URL depois do deploy:

```text
https://ujmjqbqhipjbkokncjja.functions.supabase.co/pipedrive-sync
```

### Secrets necessários

Configurar no Supabase:

```bash
supabase secrets set PIPEDRIVE_API_TOKEN="..."
supabase secrets set PIPEDRIVE_WEBHOOK_SECRET="..."
supabase secrets set INTEGRATION_INTERNAL_TOKEN="..."
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são disponibilizados pelo Supabase Functions no ambiente do projeto. Se não estiverem, configure também como secrets.

Nunca colocar `PIPEDRIVE_API_TOKEN` nem `SUPABASE_SERVICE_ROLE_KEY` no frontend.

## Inbound, Pipedrive → CRM

O Pipedrive chama:

```http
POST /pipedrive-sync
```

Header recomendado ou query string segura:

```text
x-vmarket-webhook-secret: valor_de_PIPEDRIVE_WEBHOOK_SECRET
```

Quando o provedor de webhook não permitir header customizado, use:

```text
https://ujmjqbqhipjbkokncjja.functions.supabase.co/pipedrive-sync?secret=valor_de_PIPEDRIVE_WEBHOOK_SECRET
```

Fluxo:

1. Recebe webhook do Pipedrive.
2. Extrai o ID do negócio Pipedrive.
3. Busca o negócio completo em `/deals/{id}` na API do Pipedrive.
4. Procura em `external_records` se esse negócio já existe no CRM.
5. Se existir, atualiza `deals`.
6. Se não existir, cria `deals`.
7. Grava ou atualiza `external_records`.
8. Sincroniza campos customizados conforme `external_field_mappings`.
9. Registra `integration_events`, `integration_logs` e `deal_history`.

## Outbound, CRM → Pipedrive

Endpoint:

```http
POST /pipedrive-sync?action=sync-deal-to-pipedrive
```

Headers:

```text
authorization: Bearer seu_token_interno
content-type: application/json
```

Body:

```json
{
  "action": "sync-deal-to-pipedrive",
  "deal_id": "UUID_DO_NEGOCIO_NO_CRM"
}
```

Fluxo:

1. Busca `deals` com empresa, pessoa, BPO e etapa.
2. Exige que o negócio tenha `organization_id` e `person_id`.
3. Procura organização no Pipedrive por nome semelhante. Se não encontrar, cria organização.
4. Procura pessoa no Pipedrive por email e depois telefone. Se não encontrar, cria pessoa vinculada à organização.
5. Verifica `external_records` para descobrir o ID do negócio no Pipedrive.
6. Se o negócio já existe, faz `PUT /deals/{id}`.
7. Se não existe, faz `POST /deals`, vinculado a `org_id`, `person_id`, `stage_id` e responsável Aleksander.
8. Envia campos preenchidos conforme `custom_fields.pipedrive_key`, ignorando campos técnicos/readonly.
9. Atualiza `external_records` para `organization`, `person` e `deal`, além de `deal_history`.

Deduplicação outbound:

- Pessoa: busca por email exato, depois telefone exato.
- Organização: busca por nome e aceita match semelhante acima do limiar interno.
- Negócio: usa `external_records`; se não houver vínculo prévio, cria novo negócio.

Inbound Pipedrive → CRM BPO:

- Webhooks continuam entrando por `pipedrive-sync`.
- Negócios cujo owner Pipedrive é Aleksander, `user_id` 28696367, são criados/atualizados no CRM BPO.
- A função replica organização, pessoa, etapa do funil e campos preenchidos para `custom_field_values`.
- Negócios de outros owners são ignorados quando ainda não existe vínculo local, para não puxar o Pipedrive inteiro para o CRM BPO.

Regra de etapa CRM BPO → Pipedrive:

- Quando um negócio já vinculado ao Pipedrive tem a etapa alterada no CRM BPO para uma etapa do funil `Pipeline de Vendas`, o CRM chama `sync-existing-deal-stage-to-pipedrive`.
- Essa ação só atualiza `stage_id` no Pipedrive se já existir registro em `external_records` para o negócio.
- Se o negócio não veio do Pipedrive ou ainda não tem vínculo externo, a ação retorna `ignored` e não cria negócio novo.
- Alterações em outros pipelines do CRM BPO não disparam atualização de etapa no Pipedrive.

## Mapeamento de campos Pipedrive

Pipedrive usa chaves internas para campos customizados. Para descobrir:

```http
GET https://api.pipedrive.com/v1/dealFields?api_token=SEU_TOKEN
```

Depois inserir mapeamentos em `external_field_mappings`.

Exemplo para campo customizado:

```sql
insert into public.external_field_mappings (
  integration_id,
  custom_field_id,
  entity,
  provider,
  provider_field_key,
  provider_field_name,
  direction
)
select
  i.id,
  cf.id,
  'deal',
  'pipedrive',
  'pipedrive_custom_field_key_aqui',
  'Volume mensal de compras',
  'bidirectional'
from public.external_integrations i
join public.custom_fields cf on cf.entity = 'deal' and cf.name = 'Volume mensal de compras'
where i.provider = 'pipedrive' and i.name = 'Pipedrive principal';
```

## Deploy

Status atual:

```text
Migration 202606220001 aplicada no Supabase em ujmjqbqhipjbkokncjja.
Edge Function pipedrive-sync deployada com --no-verify-jwt.
Secrets PIPEDRIVE_API_TOKEN, PIPEDRIVE_WEBHOOK_SECRET, INTEGRATION_INTERNAL_TOKEN e PIPEDRIVE_BASE_URL configurados.
Teste OPTIONS retornou 204.
Teste webhook vazio com segredo válido retornou {"ok":true,"ignored":true,"reason":"No deal id"}.
```

Aplicar migration:

```bash
supabase db push
```

Ou rodar o SQL no Supabase Dashboard, SQL Editor.

Deploy da função:

```bash
supabase functions deploy pipedrive-sync
```

Configurar secrets:

```bash
supabase secrets set PIPEDRIVE_API_TOKEN="..."
supabase secrets set PIPEDRIVE_WEBHOOK_SECRET="..."
supabase secrets set INTEGRATION_INTERNAL_TOKEN="..."
```

## Observações de segurança

- Frontend nunca usa token Pipedrive.
- Frontend nunca usa service role key.
- Webhook inbound usa segredo no header.
- Outbound CRM → Pipedrive exige `INTEGRATION_INTERNAL_TOKEN`.
- Logs não devem armazenar tokens.

## Próximo ajuste recomendado no CRM

Na aba Campos, adicionar interface para editar `external_field_mappings`, com:

- Campo CRM
- Campo Pipedrive
- Direção
- Status do mapeamento
- Última sincronização

A migration e a função já deixam a base preparada para isso.
