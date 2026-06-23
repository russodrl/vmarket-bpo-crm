# Make como camada auxiliar, não como integração principal

A decisão atual do CRM BPO VMarket é usar **API direta com Pipedrive** como caminho principal.

Documento principal:

```text
docs/pipedrive-direct-api.md
```

## Arquitetura principal

```text
Pipedrive Webhooks/API → Supabase Edge Function → Supabase Postgres → CRM VMarket
CRM VMarket → Supabase Edge Function → Pipedrive API
```

## Onde o Make ainda pode ajudar

Use Make para automações laterais, por exemplo:

- Enviar WhatsApp depois de mudança de etapa
- Enviar email
- Criar tarefa no Google Calendar
- Gerar PDF
- Notificar Telegram/Slack
- Criar tarefas internas

Não usar Make como fonte principal de sincronização de negócio/campo entre Pipedrive e CRM.

## Por quê

- Campo customizado do Pipedrive usa chaves internas.
- O CRM precisa manter IDs internos e externos com consistência.
- Precisamos de logs e reprocessamento.
- Um cenário Make grande fica difícil de versionar e auditar.

## Se o Make precisar ler dados do CRM

Base REST Supabase:

```text
https://ujmjqbqhipjbkokncjja.supabase.co/rest/v1
```

Ler campos de negócio:

```http
GET /custom_fields?entity=eq.deal&order=sort_order.asc
```

Ler valores de um negócio:

```http
GET /custom_field_values?entity_id=eq.DEAL_ID
```

Ler ligação CRM ↔ Pipedrive:

```http
GET /external_records?provider=eq.pipedrive&entity=eq.deal&internal_id=eq.DEAL_ID
```

## Se o Make precisar disparar sync CRM → Pipedrive

Use a Edge Function:

```http
POST https://ujmjqbqhipjbkokncjja.functions.supabase.co/pipedrive-sync?action=sync-deal-to-pipedrive
```

Body:

```json
{
  "action": "sync-deal-to-pipedrive",
  "deal_id": "UUID_DO_NEGOCIO_NO_CRM"
}
```

Header:

```text
authorization: Bearer <INTEGRATION_INTERNAL_TOKEN>
content-type: application/json
```

O token interno deve ficar somente no Make/backend, nunca no frontend.
