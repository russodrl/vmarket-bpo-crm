#!/usr/bin/env python3
"""Sync Tally BPO forms to Pipedrive.

Automations covered:
- Qualification form ODEM5M: create/update person, organization and deal in Pipedrive
  in pipeline "Contratos BPO", stage "Novos", label "Contrato BPO", then add a
  qualification note with all answers.
- Registration form pbv8PJ: find person by phone, fallback email, find linked deal in
  "Contratos BPO", update person/deal fields and add a registration note with all answers.
- Backfill mode: add missing qualification/registration notes to existing deals in
  "Contratos BPO" by matching Tally submissions by phone/email.

No secrets are printed. Runtime secrets come from environment or /opt/data/.env.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import html
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

PIPEDRIVE_BASE = "https://api.pipedrive.com/v1"
PIPELINE_NAME = "Contratos BPO"
STAGE_NAME_NEW = "Novos"
DEAL_LABEL = "Contrato BPO"
QUALIFICATION_FORM_ID = "ODEM5M"
REGISTRATION_FORM_ID = "pbv8PJ"
STATE_PATH = Path(".sync-state/tally_bpo_pipedrive_state.json")
TALLY_FETCH_ATTEMPTS = 4
TALLY_FETCH_BACKOFF_SECONDS = 5

# Pipedrive custom field keys.
PERSON_KEYS = {
    "utm_source": "421b8eb91a49f03a7cb05d3b35161077b5e88d8f",
    "utm_medium": "6a3b8b12f52c92c5c5b86e1a1e6018a0f2db1447",
    "utm_campaign": "0f04f85ad114e18bd1d984270ac2e1c25631c0fb",
    "utm_content": "adda7a649f74b89d2674c746f347b827eb7e7539",
    "utm_term": "c5cbc0c43bd70646f48f0c93d3adf3d7bb1722ab",
}
DEAL_KEYS = {
    "razao_social_principal": "f363be4577b7b1ad73c3fa8108a389116b5c0635",
    "cnpj_principal": "22e8146e571b84f04631cac22a7439c3b31898fe",
    "endereco_cnpj_principal": "cd10f224338182df6eea8ac98da34d0645d737ea",
}

# Tally submission question IDs. These are the IDs returned by fetch_submissions.
QUAL = {
    "ELqY1q": "nome_completo",
    "rVDWK5": "whatsapp",
    "4LadkB": "email",
    "PlRVLV": "empresa",
    "gLblaD": "cidade",
    "VVp2Xg": "atuacao_atual",
    "2Lj5kA": "ja_vendeu_food_service",
    "x2VBQJ": "tempo_vendas_food_service",
    "Zl9yVa": "como_vende_hoje",
    "NLqyVW": "ja_fez_compras_food_service",
    "qO5eBd": "opera_sozinho_ou_equipe",
    "QdoyrA": "tamanho_equipe",
    "9ON511": "pessoas_compras",
    "eL5PAE": "regioes_atuacao",
    "WPJdoP": "tipos_operacao",
    "6RD5kO": "tempo_experiencia_food_service",
    "7oX5D9": "clientes_atuais",
    "a0OoxE": "clientes_novos_mes",
    "yxXQMX": "clientes_compras",
    "XE5aLL": "ticket_medio_bpo",
    "bLZGk2": "servicos_pretendidos",
    "k5bxAJ": "motivo_parceria",
}
QUAL_LABELS = {
    "nome_completo": "Nome completo",
    "whatsapp": "WhatsApp",
    "email": "Email",
    "empresa": "Qual nome da sua empresa?",
    "cidade": "Em qual cidade fica a sede da empresa?",
    "atuacao_atual": "Como você atua hoje?",
    "ja_vendeu_food_service": "Você já vendeu serviço para restaurantes, bares ou food service?",
    "tempo_vendas_food_service": "Há quanto tempo você trabalha com vendas para o food service?",
    "como_vende_hoje": "Como você vende hoje?",
    "ja_fez_compras_food_service": "Você já faz ou já fez compras para clientes do food service?",
    "opera_sozinho_ou_equipe": "Você opera sozinho ou tem equipe?",
    "tamanho_equipe": "Se tem equipe, quantas pessoas no total?",
    "pessoas_compras": "Dessas, quantas trabalham com compras para clientes?",
    "regioes_atuacao": "Regiões de atuação",
    "tipos_operacao": "Tipos de operação que você atende",
    "tempo_experiencia_food_service": "Tempo de experiência no food service?",
    "clientes_atuais": "Quantos clientes você atende hoje?",
    "clientes_novos_mes": "Quantos clientes novos você consegue absorver por mês?",
    "clientes_compras": "Quantos desses clientes são de operação de compras?",
    "ticket_medio_bpo": "Qual o ticket médio de vocês para operação de compras (BPO)?",
    "servicos_pretendidos": "Quais serviços você pretende oferecer?",
    "motivo_parceria": "Por que você quer ser parceiro BPO da VMarket?",
}

REG = {
    "aGWGVB": "razao_social",
    "6xqxok": "cnpj",
    "7ZQZGZ": "endereco_sede",
    "bOaOPL": "inscricao_estadual_municipal",
    "A8k8ZD": "representante_legal",
    "BBvBNQ": "nacionalidade",
    "kZLZqR": "estado_civil",
    "v2R2k0": "profissao",
    "K0X0b8": "rg_orgao_emissor",
    "L080lv": "cpf",
    "pVgVaJ": "cargo_empresa",
    "gLbk24": "email_principal",
    "pGevRB": "nome_fantasia",
    "1MW6Dl": "nome_completo",
    "J0y07o": "email_acesso",
    "M505BM": "telefone_principal",
    "bLZz00": "pessoa_1_nome",
    "Axr9Vo": "pessoa_1_cargo",
    "BZEeO4": "pessoa_1_whatsapp",
    "k5bzDd": "pessoa_2_nome",
    "v4Xz7X": "pessoa_2_cargo",
    "KLpG7z": "pessoa_2_whatsapp",
    "LXDOAz": "pessoa_3_nome",
    "pGezjy": "pessoa_3_cargo",
    "1MWRZ4": "pessoa_3_whatsapp",
    "yDODLg": "emite_nf_servico",
    "XqjqXg": "banco",
    "8e9eO5": "agencia",
    "0P4PXy": "conta_tipo",
    "zeVelR": "chave_pix",
    "52N2Ro": "regioes_atuacao",
    "dP7Pro": "tipos_operacao",
    "Yd2d8B": "clientes_novos_mes",
    "DeLeQR": "tempo_experiencia_food_service",
    "lRpRQk": "clientes_atuais",
    "zZEgd8": "clientes_compras",
    "5LXrVP": "ticket_medio_bpo",
    "RLOLp9": "servicos_oferecidos",
    "oOJOWP": "autorizacao_lgpd",
}
REG_LABELS = {
    "razao_social": "Razão social",
    "cnpj": "CNPJ",
    "endereco_sede": "Endereço completo da sede",
    "inscricao_estadual_municipal": "Inscrição estadual ou municipal",
    "representante_legal": "Nome completo do representante legal",
    "nacionalidade": "Nacionalidade",
    "estado_civil": "Estado civil",
    "profissao": "Profissão",
    "rg_orgao_emissor": "RG e órgão emissor",
    "cpf": "CPF",
    "cargo_empresa": "Cargo na empresa",
    "email_principal": "Email principal",
    "nome_fantasia": "Nome fantasia",
    "nome_completo": "Nome completo",
    "email_acesso": "Email de acesso",
    "telefone_principal": "Telefone / WhatsApp principal",
    "pessoa_1_nome": "Pessoa 1, nome completo",
    "pessoa_1_cargo": "Pessoa 1, cargo",
    "pessoa_1_whatsapp": "Pessoa 1, WhatsApp",
    "pessoa_2_nome": "Pessoa 2, nome completo",
    "pessoa_2_cargo": "Pessoa 2, cargo",
    "pessoa_2_whatsapp": "Pessoa 2, WhatsApp",
    "pessoa_3_nome": "Pessoa 3, nome completo",
    "pessoa_3_cargo": "Pessoa 3, cargo",
    "pessoa_3_whatsapp": "Pessoa 3, WhatsApp",
    "emite_nf_servico": "Sua empresa emite nota fiscal de serviço?",
    "banco": "Banco",
    "agencia": "Agência",
    "conta_tipo": "Conta e tipo",
    "chave_pix": "Chave PIX",
    "regioes_atuacao": "Regiões de atuação",
    "tipos_operacao": "Tipos de operação que você atende",
    "clientes_novos_mes": "Quantos clientes novos você consegue absorver por mês?",
    "tempo_experiencia_food_service": "Tempo de experiência no food service",
    "clientes_atuais": "Quantos clientes você atende hoje?",
    "clientes_compras": "Quantos desses clientes são de operação de compras?",
    "ticket_medio_bpo": "Qual o ticket médio de vocês para operação de compras?",
    "servicos_oferecidos": "Quais serviços você vai oferecer?",
    "autorizacao_lgpd": "Autorização LGPD",
}

QUAL_ORDER = list(QUAL_LABELS)
REG_ORDER = list(REG_LABELS)


def load_dotenv(path: str) -> None:
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(errors="ignore").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} missing")
    return value


def clean_phone(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def clean_email(value: Any) -> str:
    return str(value or "").strip().lower()


def answer_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(x).strip() for x in value if str(x).strip())
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    return str(value).strip()


def parse_submission(sub: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    values: dict[str, Any] = {
        "submission_id": sub.get("id"),
        "submitted_at": sub.get("submittedAt"),
    }
    for r in sub.get("responses", []):
        key = mapping.get(r.get("questionId"))
        if key:
            values[key] = r.get("answer")
    return values


def is_transient_tally_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    class_name = exc.__class__.__name__.lower()
    return (
        "httpstatuserror" in class_name
        or "readtimeout" in class_name
        or "connecttimeout" in class_name
        or "remoteprotocolerror" in class_name
        or "connection" in text
        or "timed out" in text
        or "timeout" in text
        or "503 service unavailable" in text
        or "502 bad gateway" in text
        or "504 gateway timeout" in text
        or "429 too many requests" in text
    )


async def fetch_submissions_once(form_id: str) -> list[dict[str, Any]]:
    key = require_env("TALLY_API_KEY")
    items: list[dict[str, Any]] = []
    page = 1
    async with streamablehttp_client("https://api.tally.so/mcp", headers={"Authorization": "Bearer " + key}, timeout=60) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            while True:
                res = await session.call_tool("fetch_submissions", {"formId": form_id, "page": page, "page_size": 50})
                text = "\n".join(getattr(c, "text", "") for c in res.content)
                data = json.loads(text[text.index("{"):])["data"]
                items.extend(s for s in data.get("submissions", []) if s.get("isCompleted"))
                if not data.get("hasMore"):
                    break
                page += 1
    return items


async def fetch_submissions(form_id: str) -> list[dict[str, Any]]:
    for attempt in range(1, TALLY_FETCH_ATTEMPTS + 1):
        try:
            return await fetch_submissions_once(form_id)
        except Exception as exc:
            if attempt >= TALLY_FETCH_ATTEMPTS or not is_transient_tally_error(exc):
                raise
            wait = TALLY_FETCH_BACKOFF_SECONDS * attempt
            print(
                f"Tally fetch transient error for form {form_id}; retry {attempt}/{TALLY_FETCH_ATTEMPTS - 1} in {wait}s: {exc.__class__.__name__}",
                file=sys.stderr,
            )
            await asyncio.sleep(wait)
    raise RuntimeError(f"Tally fetch failed for form {form_id}")


class Pipedrive:
    def __init__(self) -> None:
        self.token = require_env("PIPEDRIVE_API_TOKEN")
        self.pipeline_id: int | None = None
        self.stage_new_id: int | None = None
        self.stage_ids: set[int] = set()
        self.label_id: int | None = None

    def api(self, method: str, path: str, params: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> Any:
        q = dict(params or {})
        q["api_token"] = self.token
        url = PIPEDRIVE_BASE + path + "?" + parse.urlencode(q)
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(url, data=data, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=45) as resp:
                payload = json.load(resp)
        except error.HTTPError as exc:
            msg = exc.read().decode(errors="ignore")[:500]
            raise RuntimeError(f"Pipedrive {method} {path} HTTP {exc.code}: {msg}") from exc
        if not payload.get("success", True):
            raise RuntimeError(f"Pipedrive {method} {path} failed")
        return payload.get("data")

    def load_targets(self) -> None:
        pipelines = self.api("GET", "/pipelines") or []
        pipeline = next((p for p in pipelines if str(p.get("name", "")).strip().lower() == PIPELINE_NAME.lower()), None)
        if not pipeline:
            raise RuntimeError(f"Pipeline not found: {PIPELINE_NAME}")
        self.pipeline_id = int(pipeline["id"])
        stages = self.api("GET", "/stages", {"pipeline_id": self.pipeline_id}) or []
        self.stage_ids = {int(s["id"]) for s in stages}
        stage_new = next((s for s in stages if str(s.get("name", "")).strip().lower() == STAGE_NAME_NEW.lower()), None)
        if not stage_new:
            raise RuntimeError(f"Stage not found: {STAGE_NAME_NEW}")
        self.stage_new_id = int(stage_new["id"])
        deal_fields = self.api("GET", "/dealFields") or []
        label_field = next((f for f in deal_fields if f.get("key") == "label"), None)
        for opt in (label_field or {}).get("options") or []:
            if str(opt.get("label", "")).strip().lower() == DEAL_LABEL.lower():
                self.label_id = int(opt["id"])
                break
        if self.label_id is None:
            raise RuntimeError(f"Deal label not found: {DEAL_LABEL}")

    def search_persons(self, value: str, field: str) -> list[dict[str, Any]]:
        value = str(value or "").strip()
        if not value:
            return []
        res = self.api("GET", "/persons/search", {"term": value, "fields": field, "exact_match": "true", "limit": 10}) or {}
        return [x.get("item") for x in (res.get("items") or []) if x.get("item")]

    def find_person_by_phone_email(self, phone: str = "", email: str = "") -> dict[str, Any] | None:
        digits = clean_phone(phone)
        candidates: list[dict[str, Any]] = []
        if digits:
            # Pipedrive phone search may need either normalized or original value.
            candidates.extend(self.search_persons(digits, "phone"))
            if phone and phone != digits:
                candidates.extend(self.search_persons(phone, "phone"))
        if not candidates and email:
            candidates.extend(self.search_persons(clean_email(email), "email"))
        if not candidates:
            return None
        seen: set[int] = set()
        deduped: list[dict[str, Any]] = []
        for c in candidates:
            cid = int(c["id"])
            if cid not in seen:
                deduped.append(c)
                seen.add(cid)
        # Prefer a person that already has a deal in target pipeline.
        all_deals = self.target_deals_by_person()
        for c in deduped:
            if int(c["id"]) in all_deals:
                return c
        return deduped[0]

    def target_deals_by_person(self) -> dict[int, list[dict[str, Any]]]:
        assert self.stage_ids
        by: dict[int, list[dict[str, Any]]] = defaultdict(list)
        start = 0
        while True:
            deals = self.api("GET", "/deals", {"status": "all_not_deleted", "start": start, "limit": 500}) or []
            if not deals:
                break
            for d in deals:
                stage_id = d.get("stage_id")
                person_id = d.get("person_id")
                if isinstance(stage_id, dict):
                    stage_id = stage_id.get("value")
                if isinstance(person_id, dict):
                    person_id = person_id.get("value")
                try:
                    sid = int(stage_id)
                    pid = int(person_id)
                except Exception:
                    continue
                if sid in self.stage_ids:
                    by[pid].append(d)
            if len(deals) < 500:
                break
            start += 500
        return by

    def find_target_deals_for_person(self, person_id: int) -> list[dict[str, Any]]:
        return self.target_deals_by_person().get(int(person_id), [])

    def find_or_create_org(self, name: str) -> int:
        name = str(name or "").strip()
        if not name:
            name = "Empresa sem nome"
        res = self.api("GET", "/organizations/search", {"term": name, "exact_match": "true", "limit": 10}) or {}
        items = res.get("items") or []
        if items:
            return int(items[0]["item"]["id"])
        org = self.api("POST", "/organizations", body={"name": name})
        return int(org["id"])

    def find_or_create_person(self, values: dict[str, Any], org_id: int) -> int:
        person = self.find_person_by_phone_email(answer_to_text(values.get("whatsapp")), answer_to_text(values.get("email")))
        payload = {
            "name": answer_to_text(values.get("nome_completo")) or "Contato sem nome",
            "org_id": org_id,
            "email": [{"value": clean_email(values.get("email")), "primary": True, "label": "work"}] if clean_email(values.get("email")) else None,
            "phone": [{"value": answer_to_text(values.get("whatsapp")), "primary": True, "label": "mobile"}] if answer_to_text(values.get("whatsapp")) else None,
        }
        payload = {k: v for k, v in payload.items() if v not in (None, "", [])}
        if person:
            self.api("PUT", f"/persons/{person['id']}", body=payload)
            return int(person["id"])
        created = self.api("POST", "/persons", body=payload)
        return int(created["id"])

    def ensure_qualification_deal(self, values: dict[str, Any], org_id: int, person_id: int) -> int:
        target_deals = self.find_target_deals_for_person(person_id)
        if target_deals:
            return int(target_deals[0]["id"])
        title = answer_to_text(values.get("empresa")) or answer_to_text(values.get("nome_completo")) or "Novo parceiro BPO"
        deal = self.api("POST", "/deals", body={
            "title": title,
            "org_id": org_id,
            "person_id": person_id,
            "stage_id": self.stage_new_id,
            "label": self.label_id,
        })
        return int(deal["id"])

    def add_note(self, deal_id: int, content: str) -> int:
        note = self.api("POST", "/notes", body={"deal_id": deal_id, "content": content})
        return int(note["id"])

    def notes(self, deal_id: int) -> list[dict[str, Any]]:
        return self.api("GET", "/notes", {"deal_id": deal_id, "limit": 100, "sort": "add_time DESC"}) or []

    def update_registration_fields(self, person_id: int, deal_ids: list[int], values: dict[str, Any]) -> None:
        email = clean_email(values.get("email_principal")) or clean_email(values.get("email_acesso"))
        phone = answer_to_text(values.get("telefone_principal"))
        person_payload = {
            "name": answer_to_text(values.get("nome_completo")) or answer_to_text(values.get("representante_legal")),
            "email": [{"value": email, "primary": True, "label": "work"}] if email else None,
            "phone": [{"value": phone, "primary": True, "label": "mobile"}] if phone else None,
            PERSON_KEYS["utm_source"]: answer_to_text(values.get("nacionalidade")),
            PERSON_KEYS["utm_medium"]: answer_to_text(values.get("estado_civil")),
            PERSON_KEYS["utm_campaign"]: answer_to_text(values.get("profissao")),
            PERSON_KEYS["utm_content"]: answer_to_text(values.get("rg_orgao_emissor")),
            PERSON_KEYS["utm_term"]: answer_to_text(values.get("cpf")),
        }
        person_payload = {k: v for k, v in person_payload.items() if v not in (None, "", [])}
        self.api("PUT", f"/persons/{person_id}", body=person_payload)
        deal_payload = {
            DEAL_KEYS["razao_social_principal"]: answer_to_text(values.get("razao_social")),
            DEAL_KEYS["cnpj_principal"]: answer_to_text(values.get("cnpj")),
            DEAL_KEYS["endereco_cnpj_principal"]: answer_to_text(values.get("endereco_sede")),
        }
        deal_payload = {k: v for k, v in deal_payload.items() if v not in (None, "", [])}
        for deal_id in deal_ids:
            self.api("PUT", f"/deals/{deal_id}", body=deal_payload)


def has_qualification_note(notes: list[dict[str, Any]]) -> bool:
    text = "\n".join(re.sub("<[^>]+>", " ", n.get("content") or "") for n in notes)
    return ("Como você atua hoje?" in text and "Por que você quer ser parceiro" in text) or "Formulário de Qualificação BPO" in text


def has_registration_note(notes: list[dict[str, Any]]) -> bool:
    text = "\n".join(re.sub("<[^>]+>", " ", n.get("content") or "") for n in notes)
    return ("Razão social" in text and "Chave PIX" in text) or "Formulário de Cadastro BPO" in text


def note_html(title: str, values: dict[str, Any], labels: dict[str, str], order: list[str]) -> str:
    submitted_at = answer_to_text(values.get("submitted_at"))
    when = ""
    if submitted_at:
        try:
            dt = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
            when = dt.strftime("%b %d, %I:%M %p")
        except Exception:
            when = submitted_at
    parts = [f"<p><strong>{html.escape(title)}</strong></p>"]
    for key in order:
        value = answer_to_text(values.get(key))
        if not value:
            continue
        label = labels.get(key, key)
        suffix = f"<br><em>{html.escape(when)}</em>" if when else ""
        parts.append(f"<p><strong>{html.escape(label)}</strong><br>{html.escape(value).replace(chr(10), '<br>')}{suffix}</p>")
    return "\n".join(parts)


def match_key(phone: str = "", email: str = "") -> str:
    p = clean_phone(phone)
    e = clean_email(email)
    raw = p or e
    return hashlib.sha256(raw.encode()).hexdigest() if raw else ""


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"qualification_processed": [], "registration_processed": []}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True))


def index_submissions(subs: list[dict[str, Any]], mapping: dict[str, str], phone_key: str, email_key: str) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for sub in subs:
        values = parse_submission(sub, mapping)
        for k in [match_key(values.get(phone_key), ""), match_key("", values.get(email_key))]:
            if k:
                index[k] = values
    return index


def target_people_from_deals(pd: Pipedrive) -> dict[int, list[int]]:
    by_person: dict[int, list[int]] = defaultdict(list)
    for pid, deals in pd.target_deals_by_person().items():
        for d in deals:
            by_person[pid].append(int(d["id"]))
    return by_person


def add_missing_notes(pd: Pipedrive, qual_values: dict[str, Any] | None, reg_values: dict[str, Any] | None, deal_ids: list[int]) -> dict[str, int]:
    added = {"qualification_notes_added": 0, "registration_notes_added": 0}
    for deal_id in deal_ids:
        notes = pd.notes(deal_id)
        if qual_values and not has_qualification_note(notes):
            pd.add_note(deal_id, note_html("Formulário de Qualificação BPO", qual_values, QUAL_LABELS, QUAL_ORDER))
            added["qualification_notes_added"] += 1
            notes = pd.notes(deal_id)
        if reg_values and not has_registration_note(notes):
            pd.add_note(deal_id, note_html("Formulário de Cadastro BPO", reg_values, REG_LABELS, REG_ORDER))
            added["registration_notes_added"] += 1
    return added


async def backfill_notes_and_fields(pd: Pipedrive) -> dict[str, Any]:
    qual_subs = await fetch_submissions(QUALIFICATION_FORM_ID)
    reg_subs = await fetch_submissions(REGISTRATION_FORM_ID)
    qual_index = index_submissions(qual_subs, QUAL, "whatsapp", "email")
    reg_index = index_submissions(reg_subs, REG, "telefone_principal", "email_principal")
    by_person = target_people_from_deals(pd)
    summary = defaultdict(int)
    for person_id, deal_ids in by_person.items():
        person = pd.api("GET", f"/persons/{person_id}") or {}
        phones = person.get("phone") or []
        emails = person.get("email") or []
        keys = []
        for item in phones if isinstance(phones, list) else []:
            keys.append(match_key(item.get("value"), ""))
        for item in emails if isinstance(emails, list) else []:
            keys.append(match_key("", item.get("value")))
        qual_values = next((qual_index[k] for k in keys if k in qual_index), None)
        reg_values = next((reg_index[k] for k in keys if k in reg_index), None)
        if reg_values:
            pd.update_registration_fields(person_id, deal_ids, reg_values)
            summary["people_registration_fields_updated"] += 1
            summary["deals_registration_fields_updated"] += len(deal_ids)
        added = add_missing_notes(pd, qual_values, reg_values, deal_ids)
        for k, v in added.items():
            summary[k] += v
    # Mark current submissions as already processed so cron only acts on future answers.
    state = load_state()
    state["qualification_processed"] = sorted({*state.get("qualification_processed", []), *(s.get("id") for s in qual_subs if s.get("id"))})
    state["registration_processed"] = sorted({*state.get("registration_processed", []), *(s.get("id") for s in reg_subs if s.get("id"))})
    save_state(state)
    summary["qualification_submissions_seen"] = len(qual_subs)
    summary["registration_submissions_seen"] = len(reg_subs)
    return dict(summary)


async def process_new(pd: Pipedrive) -> dict[str, Any]:
    state = load_state()
    q_done = set(state.get("qualification_processed", []))
    r_done = set(state.get("registration_processed", []))
    summary = defaultdict(int)

    qual_subs = await fetch_submissions(QUALIFICATION_FORM_ID)
    for sub in qual_subs:
        sid = sub.get("id")
        if not sid or sid in q_done:
            continue
        values = parse_submission(sub, QUAL)
        org_id = pd.find_or_create_org(answer_to_text(values.get("empresa")))
        person_id = pd.find_or_create_person(values, org_id)
        deal_id = pd.ensure_qualification_deal(values, org_id, person_id)
        if not has_qualification_note(pd.notes(deal_id)):
            pd.add_note(deal_id, note_html("Formulário de Qualificação BPO", values, QUAL_LABELS, QUAL_ORDER))
            summary["qualification_notes_added"] += 1
        q_done.add(sid)
        summary["qualification_processed"] += 1

    reg_subs = await fetch_submissions(REGISTRATION_FORM_ID)
    for sub in reg_subs:
        sid = sub.get("id")
        if not sid or sid in r_done:
            continue
        values = parse_submission(sub, REG)
        person = pd.find_person_by_phone_email(answer_to_text(values.get("telefone_principal")), clean_email(values.get("email_principal")))
        if not person:
            summary["registration_person_not_found"] += 1
            continue
        deal_ids = [int(d["id"]) for d in pd.find_target_deals_for_person(int(person["id"]))]
        if not deal_ids:
            summary["registration_deal_not_found"] += 1
            continue
        pd.update_registration_fields(int(person["id"]), deal_ids, values)
        added = add_missing_notes(pd, None, values, deal_ids)
        for k, v in added.items():
            summary[k] += v
        r_done.add(sid)
        summary["registration_processed"] += 1

    state["qualification_processed"] = sorted(q_done)
    state["registration_processed"] = sorted(r_done)
    save_state(state)
    return dict(summary)


def form_coverage(submissions: list[dict[str, Any]], mapping: dict[str, str], labels: dict[str, str]) -> dict[str, Any]:
    parsed = [parse_submission(s, mapping) for s in submissions]
    rows = []
    total = len(parsed)
    for key, label in labels.items():
        filled = sum(1 for p in parsed if answer_to_text(p.get(key)))
        rows.append({"field": label, "filled": filled, "total": total})
    return {"completed_submissions": total, "fields": rows}


async def check_forms() -> dict[str, Any]:
    qual_subs = await fetch_submissions(QUALIFICATION_FORM_ID)
    reg_subs = await fetch_submissions(REGISTRATION_FORM_ID)
    return {
        "qualification": form_coverage(qual_subs, QUAL, QUAL_LABELS),
        "registration": form_coverage(reg_subs, REG, REG_LABELS),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="/opt/data/.env")
    parser.add_argument("--check-forms", action="store_true")
    parser.add_argument("--backfill-notes-and-fields", action="store_true")
    parser.add_argument("--process-new", action="store_true")
    args = parser.parse_args()

    load_dotenv(args.env)
    load_dotenv(".env")

    if args.check_forms:
        print(json.dumps(await check_forms(), ensure_ascii=False, indent=2))
        return

    pd = Pipedrive()
    pd.load_targets()
    if args.backfill_notes_and_fields:
        print(json.dumps(await backfill_notes_and_fields(pd), ensure_ascii=False, indent=2))
        return
    if args.process_new:
        print(json.dumps(await process_new(pd), ensure_ascii=False, indent=2))
        return
    parser.error("choose --check-forms, --backfill-notes-and-fields or --process-new")


if __name__ == "__main__":
    asyncio.run(main())
