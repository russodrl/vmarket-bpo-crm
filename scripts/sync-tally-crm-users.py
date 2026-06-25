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
import sys
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
            user[key] = number_or_none(ans)
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


def sync_users(users):
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
        status, data = supabase_request("POST", "/rest/v1/crm_users?on_conflict=email", payload)
        synced += 1
    return synced, skipped


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
    synced, skipped = sync_users(users)
    summary.update({"synced": synced, "skipped": skipped})
    print(json.dumps(summary, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
