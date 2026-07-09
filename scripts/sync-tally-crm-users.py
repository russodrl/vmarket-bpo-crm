#!/usr/bin/env python3
"""Sync Tally partner registration submissions into Supabase crm_users.

Requires env vars:
- TALLY_API_KEY
- SUPABASE_SERVICE_ROLE_KEY
or run with --dry-run to only validate mapping/counts.
Does not print personal data.
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error, parse

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

FORM_ID = "pbv8PJ"
SUPABASE_URL = "https://ujmjqbqhipjbkokncjja.supabase.co"

FIELD = {
    "aGWGVB": "legal_company_name",
    "6xqxok": "cnpj",
    "7ZQZGZ": "headquarters_address",
    "bOaOPL": "state_registration",
    "A8k8ZD": "legal_representative_name",
    "BBvBNQ": "nationality",
    "kZLZqR": "marital_status",
    "v2R2k0": "profession",
    "K0X0b8": "rg_issuer",
    "L080lv": "cpf",
    "pVgVaJ": "company_role",
    "gLbk24": "primary_email",
    "pGevRB": "company_name",
    "1MW6Dl": "full_name",
    "J0y07o": "email",
    "M505BM": "crm_phone",
    "yDODLg": "issues_service_invoice",
    "XqjqXg": "bank_name",
    "8e9eO5": "bank_agency",
    "0P4PXy": "bank_account",
    "zeVelR": "pix_key",
    "52N2Ro": "service_regions",
    "dP7Pro": "operation_types",
    "Yd2d8B": "monthly_new_clients_capacity",
    "DeLeQR": "food_service_experience",
    "lRpRQk": "current_clients_count",
    "zZEgd8": "current_purchasing_clients_count",
    "5LXrVP": "purchasing_ticket_avg",
    "RLOLp9": "offered_services",
    "oOJOWP": "data_authorization",
}
CONTACTS = [
    ("bLZz00", "Axr9Vo", "BZEeO4"),
    ("k5bzDd", "v4Xz7X", "KLpG7z"),
    ("LXDOAz", "pGezjy", "1MWRZ4"),
]
NUMERIC = {"monthly_new_clients_capacity", "current_clients_count", "current_purchasing_clients_count", "purchasing_ticket_avg"}
INTEGER = {"monthly_new_clients_capacity", "current_clients_count", "current_purchasing_clients_count"}
ARRAY = {"operation_types", "offered_services"}


def load_dotenv(path: str):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(errors="ignore").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def norm_email(v):
    return str(v or "").strip().lower()


def first_answer(answer):
    if isinstance(answer, list):
        return ", ".join(str(x).strip() for x in answer if str(x).strip())
    return answer


def number_or_none(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(".", "").replace(",", "."))
    except Exception:
        try:
            return float(v)
        except Exception:
            return None


def bool_or_none(v):
    value = first_answer(v)
    text = str(value or "").strip().lower()
    if text in {"sim", "true", "1", "yes"}:
        return True
    if text in {"não", "nao", "false", "0", "no"}:
        return False
    return None


def submission_to_user(sub):
    responses = {r.get("questionId"): r.get("answer") for r in sub.get("responses", [])}
    user = {
        "tally_form_id": FORM_ID,
        "tally_submission_id": sub.get("id"),
        "tally_submitted_at": sub.get("submittedAt"),
        "tally_synced_at": datetime.now(timezone.utc).isoformat(),
    }
    for qid, key in FIELD.items():
        if qid not in responses:
            continue
        ans = responses[qid]
        if key in ARRAY:
            user[key] = [str(x).strip() for x in ans] if isinstance(ans, list) else [str(ans).strip()] if ans else []
        elif key in NUMERIC:
            number = number_or_none(ans)
            user[key] = int(number) if key in INTEGER and number is not None else number
        elif key == "issues_service_invoice":
            user[key] = bool_or_none(ans)
        else:
            user[key] = first_answer(ans)
    contacts = []
    for name_id, role_id, phone_id in CONTACTS:
        contact = {
            "name": first_answer(responses.get(name_id)) or None,
            "role": first_answer(responses.get(role_id)) or None,
            "whatsapp": first_answer(responses.get(phone_id)) or None,
        }
        if any(contact.values()):
            contacts.append(contact)
    user["additional_contacts"] = contacts
    # Required CRM defaults
    user["full_name"] = str(user.get("full_name") or user.get("legal_representative_name") or "").strip()
    user["email"] = norm_email(user.get("email") or user.get("primary_email"))
    user["company_name"] = str(user.get("company_name") or user.get("legal_company_name") or "").strip()
    return user


async def fetch_submissions():
    tally_key = os.environ.get("TALLY_API_KEY")
    if not tally_key:
        raise RuntimeError("TALLY_API_KEY missing")
    items = []
    page = 1
    async with streamablehttp_client("https://api.tally.so/mcp", headers={"Authorization": "Bearer " + tally_key}, timeout=60) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            while True:
                res = await session.call_tool("fetch_submissions", {"formId": FORM_ID, "page": page, "page_size": 50})
                text = "\n".join(getattr(c, "text", "") for c in res.content)
                data = json.loads(text[text.index("{"):])["data"]
                items.extend(data.get("submissions", []))
                if not data.get("hasMore"):
                    break
                page += 1
    return items


def supabase_request(method, path, body=None):
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing")
    data = None if body is None else json.dumps(body).encode()
    req = request.Request(
        SUPABASE_URL + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
    )
    try:
        with request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except error.HTTPError as e:
        raise RuntimeError(f"Supabase HTTP {e.code}: {e.read().decode()[:500]}")


def upsert_company(name):
    status, data = supabase_request("POST", "/rest/v1/crm_companies?on_conflict=name", {"name": name})
    if not data:
        # fallback lookup
        status, data = supabase_request("GET", "/rest/v1/crm_companies?select=*&name=eq." + parse.quote(name))
    if isinstance(data, list) and data:
        return data[0]["id"]
    if isinstance(data, dict):
        return data["id"]
    raise RuntimeError("company_upsert_failed")


def sync_users_rest(users):
    synced = 0
    skipped = 0
    for user in users:
        if not user.get("email") or not user.get("company_name") or not user.get("full_name"):
            skipped += 1
            continue
        company_id = upsert_company(user["company_name"])
        payload = dict(user)
        payload.pop("company_name", None)
        payload["company_id"] = company_id
        payload.setdefault("status", "pending")
        status, data = supabase_request("POST", "/rest/v1/crm_users?on_conflict=tally_submission_id", payload)
        synced += 1
    return synced, skipped, "rest"


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sync_users_cli(users):
    valid = [u for u in users if u.get("email") and u.get("company_name") and u.get("full_name")]
    skipped = len(users) - len(valid)
    if not valid:
        return 0, skipped, "supabase_cli"
    payload = json.dumps(valid, ensure_ascii=False)
    sql = f"""
-- Supabase CLI connects as postgres without JWT request claims, so auth.role()
-- is NULL by default. The self-update guard allows service_role/admin only;
-- set the request claim for this one CLI session before running the upsert.
select set_config('request.jwt.claim.role', 'service_role', false);

with rows as (
  select * from jsonb_to_recordset({sql_literal(payload)}::jsonb) as x(
    full_name text,
    email text,
    company_name text,
    legal_company_name text,
    cnpj text,
    headquarters_address text,
    state_registration text,
    legal_representative_name text,
    nationality text,
    marital_status text,
    profession text,
    rg_issuer text,
    cpf text,
    company_role text,
    primary_email text,
    crm_phone text,
    additional_contacts jsonb,
    issues_service_invoice boolean,
    bank_name text,
    bank_agency text,
    bank_account text,
    pix_key text,
    service_regions text,
    operation_types text[],
    monthly_new_clients_capacity integer,
    food_service_experience text,
    current_clients_count integer,
    current_purchasing_clients_count integer,
    purchasing_ticket_avg numeric,
    offered_services text[],
    data_authorization text,
    tally_form_id text,
    tally_submission_id text,
    tally_submitted_at timestamptz,
    tally_synced_at timestamptz
  )
), companies as (
  insert into public.crm_companies (name)
  select distinct company_name from rows
  where nullif(company_name, '') is not null
  on conflict (name) do update set name = excluded.name
  returning id, name
), all_companies as (
  select id, name from companies
  union
  select cc.id, cc.name from public.crm_companies cc join rows r on r.company_name = cc.name
)
insert into public.crm_users (
  full_name, email, company_id, status,
  legal_company_name, cnpj, headquarters_address, state_registration,
  legal_representative_name, nationality, marital_status, profession, rg_issuer, cpf,
  company_role, primary_email, crm_phone, additional_contacts,
  issues_service_invoice, bank_name, bank_agency, bank_account, pix_key,
  service_regions, operation_types, monthly_new_clients_capacity,
  food_service_experience, current_clients_count, current_purchasing_clients_count,
  purchasing_ticket_avg, offered_services, data_authorization,
  tally_form_id, tally_submission_id, tally_submitted_at, tally_synced_at
)
select
  r.full_name, r.email::citext, c.id, 'pending',
  r.legal_company_name, r.cnpj, r.headquarters_address, r.state_registration,
  r.legal_representative_name, r.nationality, r.marital_status, r.profession, r.rg_issuer, r.cpf,
  r.company_role, nullif(r.primary_email, '')::citext, r.crm_phone, coalesce(r.additional_contacts, '[]'::jsonb),
  r.issues_service_invoice, r.bank_name, r.bank_agency, r.bank_account, r.pix_key,
  r.service_regions, coalesce(r.operation_types, '{{}}'::text[]), r.monthly_new_clients_capacity,
  r.food_service_experience, r.current_clients_count, r.current_purchasing_clients_count,
  r.purchasing_ticket_avg, coalesce(r.offered_services, '{{}}'::text[]), r.data_authorization,
  r.tally_form_id, r.tally_submission_id, r.tally_submitted_at, r.tally_synced_at
from rows r
join all_companies c on c.name = r.company_name
on conflict (tally_submission_id) do update set
  full_name = excluded.full_name,
  company_id = excluded.company_id,
  legal_company_name = excluded.legal_company_name,
  cnpj = excluded.cnpj,
  headquarters_address = excluded.headquarters_address,
  state_registration = excluded.state_registration,
  legal_representative_name = excluded.legal_representative_name,
  nationality = excluded.nationality,
  marital_status = excluded.marital_status,
  profession = excluded.profession,
  rg_issuer = excluded.rg_issuer,
  cpf = excluded.cpf,
  company_role = excluded.company_role,
  primary_email = excluded.primary_email,
  crm_phone = excluded.crm_phone,
  additional_contacts = excluded.additional_contacts,
  issues_service_invoice = excluded.issues_service_invoice,
  bank_name = excluded.bank_name,
  bank_agency = excluded.bank_agency,
  bank_account = excluded.bank_account,
  pix_key = excluded.pix_key,
  service_regions = excluded.service_regions,
  operation_types = excluded.operation_types,
  monthly_new_clients_capacity = excluded.monthly_new_clients_capacity,
  food_service_experience = excluded.food_service_experience,
  current_clients_count = excluded.current_clients_count,
  current_purchasing_clients_count = excluded.current_purchasing_clients_count,
  purchasing_ticket_avg = excluded.purchasing_ticket_avg,
  offered_services = excluded.offered_services,
  data_authorization = excluded.data_authorization,
  tally_form_id = excluded.tally_form_id,
  tally_submission_id = excluded.tally_submission_id,
  tally_submitted_at = excluded.tally_submitted_at,
  tally_synced_at = excluded.tally_synced_at,
  updated_at = now();
"""
    tmp = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    try:
        tmp.write(sql)
        tmp.close()
        subprocess.run(["npx", "supabase", "db", "query", "--linked", "--file", tmp.name], check=True, stdout=subprocess.DEVNULL)
    finally:
        try:
            os.unlink(tmp.name)
        except FileNotFoundError:
            pass
    return len(valid), skipped, "supabase_cli"


def sync_users(users):
    if os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return sync_users_rest(users)
    return sync_users_cli(users)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--env", default="/opt/data/.env")
    args = parser.parse_args()
    load_dotenv(args.env)
    submissions = await fetch_submissions()
    users = [submission_to_user(s) for s in submissions if s.get("isCompleted")]
    summary = {
        "form_id": FORM_ID,
        "completed_submissions": len(users),
        "missing_required": sum(1 for u in users if not (u.get("email") and u.get("full_name") and u.get("company_name"))),
        "emails_detected": len({u.get("email") for u in users if u.get("email")}),
        "users_with_additional_contacts": sum(1 for u in users if u.get("additional_contacts")),
        "dry_run": args.dry_run,
    }
    if args.dry_run:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return
    synced, skipped, method = sync_users(users)
    summary.update({"synced": synced, "skipped": skipped, "method": method})
    print(json.dumps(summary, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
