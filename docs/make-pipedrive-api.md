# Integração Make / Pipedrive / VMarket CRM

## Conceito

Cada negócio tem um ID fixo em `deals.id` e abre no CRM pela URL:

```text
https://russodrl.github.io/vmarket-bpo-crm/?deal=DEAL_ID
```

Campos configuráveis ficam em:

- `custom_fields`, cadastro do campo
- `custom_field_values`, valor do campo por negócio, empresa, pessoa ou atividade

Para negócios, use:

- `custom_fields.entity = 'deal'`
- `custom_field_values.entity_id = deals.id`
- `custom_field_values.field_id = custom_fields.id`

## Endpoints REST Supabase

Base URL:

```text
https://ujmjqbqhipjbkokncjja.supabase.co/rest/v1
```

Headers no Make:

```text
apikey: SUPABASE_ANON_OR_SERVICE_KEY
authorization: Bearer SUPABASE_ANON_OR_SERVICE_KEY
content-type: application/json
prefer: return=representation
```

Use service role key apenas em cenários server-to-server no Make. Não coloque service role key no frontend.

## Ler negócios

```http
GET /deals?select=*,organizations(*),people(*),bpo_partners(*),pipeline_stages(*)&id=eq.DEAL_ID
```

## Ler campos configuráveis de negócio

```http
GET /custom_fields?entity=eq.deal&order=sort_order.asc
```

Cada campo retorna:

- `id`, usar como `field_id`
- `name`, nome visível no CRM
- `field_type`, tipo do campo
- `options`, opções quando for select

## Ler valores customizados de um negócio

```http
GET /custom_field_values?entity_id=eq.DEAL_ID
```

## Enviar ou atualizar valor de campo customizado

```http
POST /custom_field_values
```

Headers adicionais:

```text
prefer: resolution=merge-duplicates,return=representation
```

Body:

```json
{
  "field_id": "FIELD_ID",
  "entity_id": "DEAL_ID",
  "value": "valor vindo do Pipedrive"
}
```

Para número ou dinheiro:

```json
{
  "field_id": "FIELD_ID",
  "entity_id": "DEAL_ID",
  "value": 12345.67
}
```

Para múltipla escolha:

```json
{
  "field_id": "FIELD_ID",
  "entity_id": "DEAL_ID",
  "value": ["opcao 1", "opcao 2"]
}
```

A tabela tem `unique(field_id, entity_id)`, então o upsert atualiza o mesmo campo do mesmo negócio.

## Criar campo novo via Make

```http
POST /custom_fields
```

Body:

```json
{
  "entity": "deal",
  "name": "ID Pipedrive",
  "field_type": "text",
  "options": [],
  "sort_order": 10
}
```

## Campos sugeridos para Pipedrive

- `ID Pipedrive`, tipo `text`
- `Pipeline Pipedrive`, tipo `text`
- `Stage Pipedrive`, tipo `text`
- `Origem Make`, tipo `text`
- `Última sincronização Pipedrive`, tipo `date`
- `Status integração`, tipo `single_option`, opções: `Sincronizado`, `Pendente`, `Erro`

## Fluxo Make recomendado

1. Watch Deal Updated no Pipedrive.
2. Procurar negócio no Supabase por campo customizado `ID Pipedrive`.
3. Se existir, atualizar `deals` e `custom_field_values`.
4. Se não existir, criar `organizations`, `people`, `deals` e depois gravar o `ID Pipedrive` em `custom_field_values`.
5. Para enviar CRM -> Pipedrive, buscar negócio por `deal_id`, montar payload com `custom_fields` + `custom_field_values`, atualizar o deal no Pipedrive.
