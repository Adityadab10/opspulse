"""Verified PostgreSQL connection parameters for the fresh OpsPulse project."""

import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit

PROJECT = "gobvtqiwtgmbjkxtaiuq"
POOLER = "aws-1-ap-northeast-1.pooler.supabase.com"


def new_database_connection(variable="OPSPULSE_NEW_DATABASE_URL"):
    value = os.getenv(variable)
    if not value:
        raise RuntimeError(f"{variable} is required")
    try:
        url = urlsplit(value)
        valid_host = (
            url.hostname == POOLER
            and re.fullmatch(rf"[a-zA-Z0-9_]+\.{PROJECT}", url.username or "")
        ) or url.hostname == f"db.{PROJECT}.supabase.co"
        valid_url = (
            valid_host and url.scheme in {"postgres", "postgresql"}
            and url.port == 5432 and url.path == "/postgres" and url.password
            and not url.fragment and all(
                key == "sslmode" and mode in {"require", "verify-full"}
                for key, mode in parse_qsl(url.query, keep_blank_values=True)
            )
        )
    except ValueError:
        raise RuntimeError("Invalid OPSPULSE_NEW_DATABASE_URL") from None
    if not valid_url:
        raise RuntimeError("New database URL must identify the OpsPulse Supabase project over port 5432")

    ca_file = os.getenv("OPSPULSE_DATABASE_CA_FILE")
    if not ca_file or not Path(ca_file).is_file():
        raise RuntimeError("OPSPULSE_DATABASE_CA_FILE must identify the trusted Supabase CA")
    return urlunsplit(url._replace(query="")), {
        "sslmode": "verify-full",
        "sslrootcert": ca_file,
        "connect_timeout": 8,
    }
