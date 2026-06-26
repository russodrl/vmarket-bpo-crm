# Automação direta Tally → CRM BPO → Pipedrive

Este documento descreve a integração direta, sem Make, entre os formulários Tally do programa BPO, o CRM BPO VMarket em Supabase e o Pipedrive.

## Decisão atual

A automação principal é feita por scripts versionados no projeto e por APIs diretas:

```text
Tally API → scripts do projeto → Supabase CRM BPO
Tally API → scripts do projeto → Pipedrive API
Pipedrive Webhooks/API → Supabase Edge Function → CRM BPO
CRM BPO → Supabase Edge Function → Pipedrive API
```

O Make não é usado como caminho principal desta integração.

## Agendamento ativo

A rotina recorrente está agendada no Hermes cron:

```text
Nome: vmarket-tally-bpo-pipedrive-sync
Frequência: every 5m
Script: vmarket_tally_pipedrive_sync.sh
Workdir: /opt/data/projects/vmarket-bpo-crm
```

O wrapper executado pelo cron fica em:

```text
/opt/data/.hermes/scripts/vmarket_tally_pipedrive_sync.sh
```

Ele roda:

```bash
python3 scripts/sync-tally-crm-users.py
python3 scripts/tally_bpo_pipedrive_sync.py --process-new
```

A saída é silenciosa quando não há novidade. Se houver nova resposta processada para Pipedrive, o resumo é enviado para o chat de origem. Erros de execução geram alerta pelo próprio cron.

## Secrets usados

Os scripts dependem de variáveis de ambiente já disponíveis no ambiente Hermes:

```text
TALLY_API_KEY
PIPEDRIVE_API_TOKEN
SUPABASE_ACCESS_TOKEN
```

Quando `SUPABASE_SERVICE_ROLE_KEY` não está disponível, o script do CRM usa `npx supabase db query --linked` com o token Supabase já autenticado. Nenhum segredo é impresso nos logs.

## Formulários Tally

### Qualificação de Parceiro BPO <> VMarket

```text
Form ID: ODEM5M
```

Uso:

- criar ou atualizar pessoa no Pipedrive;
- criar ou reutilizar organização no Pipedrive;
- criar ou reutilizar negócio no funil `Contratos BPO`;
- adicionar nota com todas as respostas do formulário de qualificação.

Campos principais mapeados:

```text
Nome completo → pessoa.name
WhatsApp → pessoa.phone
Email → pessoa.email
Em qual cidade fica a sede da empresa? → usado como dado de qualificação e nota
Qual nome da sua empresa? → organização.name e negócio.title
```

Destino Pipedrive:

```text
Pipeline: Contratos BPO
Pipeline ID: 7
Etapa: Novos
Etapa ID: 62
Etiqueta: Contrato BPO
Etiqueta ID: 264
```

### Cadastro de Parceiro BPO <> VMarket

```text
Form ID: pbv8PJ
```

Uso:

- atualizar os dados do cadastro no CRM BPO, tabela `crm_users`;
- localizar pessoa no Pipedrive por telefone;
- se não encontrar por telefone, localizar por e-mail;
- localizar o negócio vinculado no funil `Contratos BPO`;
- atualizar campos da pessoa e do negócio;
- adicionar nota com todas as respostas do formulário de cadastro.

Campos de pessoa no Pipedrive:

```text
nome completo → nome da pessoa
email principal → email
telefone/whatsapp principal → telefone
nacionalidade → utm_source
estado civil → utm_medium
profissão → utm_campaign
rg e órgão emissor → utm_content
cpf → utm_term
```

Campos de negócio no Pipedrive:

```text
Razão Social → Razão Social Principal
CNPJ → CNPJ Principal
Endereço completo da sede → Endereço CNPJ Principal
```

## Arquivos versionados

### `scripts/sync-tally-crm-users.py`

Sincroniza as respostas do formulário de cadastro BPO para o CRM BPO em Supabase.

Comando manual:

```bash
python3 scripts/sync-tally-crm-users.py
```

Validação sem escrita:

```bash
python3 scripts/sync-tally-crm-users.py --dry-run
```

### `scripts/tally_bpo_pipedrive_sync.py`

Sincroniza os formulários Tally com o Pipedrive e faz backfill de notas/campos.

Checar cobertura de campos dos formulários:

```bash
python3 scripts/tally_bpo_pipedrive_sync.py --check-forms
```

Processar somente respostas novas:

```bash
python3 scripts/tally_bpo_pipedrive_sync.py --process-new
```

Fazer backfill de campos/notas em negócios existentes do funil `Contratos BPO`:

```bash
python3 scripts/tally_bpo_pipedrive_sync.py --backfill-notes-and-fields
```

O estado de submissões já processadas fica em:

```text
.sync-state/tally_bpo_pipedrive_state.json
```

Esse diretório é runtime local e não entra no Git.

## Validação executada

### Cobertura dos formulários

Resultado validado pelo comando `--check-forms`:

```text
qualification completed 2 fields 22 partial_or_empty_fields 0
registration completed 8 fields 39 partial_or_empty_fields 10
```

No formulário de cadastro, os campos parciais são opcionais:

```text
Inscrição estadual ou municipal
Pessoa 1, nome/cargo/WhatsApp
Pessoa 2, nome/cargo/WhatsApp
Pessoa 3, nome/cargo/WhatsApp
```

### Backfill Pipedrive já executado

Resultado retornado pelo script:

```json
{
  "people_registration_fields_updated": 8,
  "deals_registration_fields_updated": 8,
  "qualification_notes_added": 0,
  "registration_notes_added": 4,
  "qualification_submissions_seen": 2,
  "registration_submissions_seen": 8
}
```

Interpretação:

- 8 pessoas tiveram campos de cadastro atualizados no Pipedrive;
- 8 negócios tiveram campos de cadastro atualizados no Pipedrive;
- as notas de qualificação já existiam;
- 4 notas de cadastro estavam faltando e foram adicionadas;
- o script viu 2 respostas de qualificação e 8 respostas de cadastro.

### Validação CRM BPO

Resultado da agregação em `crm_users`:

```text
tally_users: 8
with_cnpj: 8
with_phone: 8
with_regions: 8
with_extra_contacts: 5
```

## Relação com a integração CRM BPO ↔ Pipedrive

A integração principal CRM/Pipedrive continua em:

```text
supabase/functions/pipedrive-sync/index.ts
docs/pipedrive-direct-api.md
```

Fluxos já existentes:

```text
Pipedrive → CRM BPO: webhooks deal.create e deal.change
CRM BPO → Pipedrive: Edge Function pipedrive-sync
```

A automação Tally complementa esse fluxo, criando ou enriquecendo os dados que chegam ao Pipedrive e ao CRM BPO.

## Observações operacionais

- O script não duplica notas de qualificação ou cadastro quando identifica que a nota já existe.
- O processamento de novas respostas é idempotente por ID de submissão do Tally.
- O wrapper do cron é silencioso sem novidades para evitar spam no Telegram.
- Para testar com submissões reais, preencher os formulários Tally publicados e aguardar até 5 minutos, ou rodar manualmente `python3 scripts/tally_bpo_pipedrive_sync.py --process-new`.
