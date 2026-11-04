"""Runtime integration settings persistence, secret encryption, and diagnostics (`FB-P9-002`)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import os
from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient, ServiceHealthStatus
from app.config import (
    DEFAULT_GATEWAY_IP,
    Settings,
    apply_runtime_overrides,
    clear_runtime_overrides,
    set_runtime_overrides,
)
from app.models import AuditLog, SystemSetting

MASKED_SECRET_PLACEHOLDER = "••••••••"

SECRET_SETTING_KEYS = frozenset(
    {
        "opnsense_api_key",
        "opnsense_api_secret",
        "elasticsearch_api_key",
    }
)

BOOL_SETTING_KEYS = frozenset(
    {
        "opnsense_verify_ssl",
        "elasticsearch_verify_ssl",
    }
)

FLOAT_SETTING_KEYS = frozenset(
    {
        "opnsense_timeout_seconds",
        "elasticsearch_timeout_seconds",
    }
)


class IntegrationSettingsView(BaseModel):
    """Sanitized runtime integration settings view returned to Admin UI."""

    source: Literal["ui_override", "env"]
    opnsense_base_url: str
    has_opnsense_api_key: bool
    opnsense_api_key_masked: str
    has_opnsense_api_secret: bool
    opnsense_api_secret_masked: str
    opnsense_verify_ssl: bool
    opnsense_ca_cert_path: str
    opnsense_timeout_seconds: float
    opnsense_protected_ips: str
    elasticsearch_url: str
    has_elasticsearch_api_key: bool
    elasticsearch_api_key_masked: str
    elasticsearch_verify_ssl: bool
    elasticsearch_ca_cert_path: str
    elasticsearch_timeout_seconds: float
    elasticsearch_index_patterns: str
    updated_by: str | None = None
    updated_at: str | None = None


class IntegrationSettingsUpdatePayload(BaseModel):
    """Payload for PUT /api/v1/system/settings."""

    opnsense_base_url: str | None = None
    opnsense_api_key: str | None = None
    opnsense_api_secret: str | None = None
    opnsense_verify_ssl: bool | None = None
    opnsense_ca_cert_path: str | None = None
    opnsense_timeout_seconds: float | None = Field(default=None, gt=0.5, le=120.0)
    opnsense_protected_ips: str | None = None
    elasticsearch_url: str | None = None
    elasticsearch_api_key: str | None = None
    elasticsearch_verify_ssl: bool | None = None
    elasticsearch_ca_cert_path: str | None = None
    elasticsearch_timeout_seconds: float | None = Field(default=None, gt=0.5, le=120.0)
    elasticsearch_index_patterns: str | None = None


class ConnectivityTestResponse(BaseModel):
    """Detailed connectivity diagnostic result for OPNsense or Elasticsearch."""

    service: Literal["opnsense", "elasticsearch"]
    reachable: bool
    status: Literal["healthy", "degraded", "unhealthy"]
    latency_ms: float
    message: str
    error_diagnostic: str | None = None
    troubleshooting_hint: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


def _derive_keystream(master_key: bytes, nonce: bytes, length: int) -> bytes:
    """Generate a deterministic SHA-256 counter keystream for secret encryption."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hashlib.sha256(
            master_key + nonce + counter.to_bytes(4, "big")
        ).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_secret_value(plaintext: str, app_secret_key: str) -> str:
    """Encrypt a secret string using HMAC-authenticated SHA-256 stream cipher (`ENC:v1:...`)."""
    raw_bytes = plaintext.encode("utf-8")
    master_key = hashlib.sha256(app_secret_key.encode("utf-8")).digest()
    nonce = os.urandom(16)
    stream = _derive_keystream(master_key, nonce, len(raw_bytes))
    ciphertext = bytes(a ^ b for a, b in zip(raw_bytes, stream, strict=True))
    mac = hmac.new(master_key, b"v1" + nonce + ciphertext, hashlib.sha256).digest()
    return (
        "ENC:v1:"
        f"{base64.urlsafe_b64encode(nonce).decode('ascii')}:"
        f"{base64.urlsafe_b64encode(ciphertext).decode('ascii')}:"
        f"{base64.urlsafe_b64encode(mac).decode('ascii')}"
    )


def decrypt_secret_value(encoded: str, app_secret_key: str) -> str:
    """Decrypt an `ENC:v1:...` secret string and verify HMAC integrity."""
    if not encoded or not encoded.startswith("ENC:v1:"):
        return encoded
    parts = encoded.split(":")
    if len(parts) != 5:
        raise ValueError("Malformed encrypted secret format.")
    nonce = base64.urlsafe_b64decode(parts[2].encode("ascii"))
    ciphertext = base64.urlsafe_b64decode(parts[3].encode("ascii"))
    expected_mac = base64.urlsafe_b64decode(parts[4].encode("ascii"))
    master_key = hashlib.sha256(app_secret_key.encode("utf-8")).digest()
    actual_mac = hmac.new(
        master_key, b"v1" + nonce + ciphertext, hashlib.sha256
    ).digest()
    if not hmac.compare_digest(actual_mac, expected_mac):
        raise ValueError("Encrypted secret HMAC verification failed.")
    stream = _derive_keystream(master_key, nonce, len(ciphertext))
    plaintext_bytes = bytes(a ^ b for a, b in zip(ciphertext, stream, strict=True))
    return plaintext_bytes.decode("utf-8")


def validate_and_normalize_url(raw_url: str, field_name: str) -> str:
    """Validate that a base URL starts with http:// or https:// and strip trailing slash."""
    cleaned = (raw_url or "").strip().rstrip("/")
    if not cleaned.startswith(("http://", "https://")):
        raise ValueError(
            f"{field_name} must start with http:// or https:// (got '{raw_url}')."
        )
    return cleaned


def validate_and_normalize_protected_ips(raw_ips: str) -> str:
    """Validate comma-separated IPv4/IPv6 addresses for OPNSENSE_PROTECTED_IPS."""
    items = [item.strip() for item in (raw_ips or "").split(",") if item.strip()]
    validated: list[str] = []
    for item in items:
        try:
            ip_obj = ipaddress.ip_address(item)
        except ValueError as exc:
            raise ValueError(
                f"Invalid IP address in opnsense_protected_ips: '{item}'"
            ) from exc
        validated.append(str(ip_obj))
    if DEFAULT_GATEWAY_IP not in validated:
        validated.insert(0, DEFAULT_GATEWAY_IP)
    return ",".join(dict.fromkeys(validated))


def build_troubleshooting_hint(
    service: Literal["opnsense", "elasticsearch"],
    message: str,
    details: dict[str, Any],
) -> tuple[str, str]:
    """Generate a clear `error_diagnostic` and `troubleshooting_hint` from a failed check."""
    status_code = details.get("status_code")
    url = details.get("url", "")
    msg_lower = (message or "").lower()

    if status_code in (401, 403) or "auth" in msg_lower or "forbidden" in msg_lower:
        if service == "opnsense":
            hint = (
                "Verify the OPNsense API Key and Secret belong to an active user "
                "(e.g. svc_gateway_ui) with Diagnostics: ARP Table, Dnsmasq Leases, "
                "Firewall: Alias: Edit, and Firewall: States privileges."
            )
        else:
            hint = (
                "Verify the Elasticsearch Base64 API Key is valid and has 'read' + "
                "'view_index_metadata' on logs-pfsense.log* and 'monitor' cluster privilege."
            )
        return (
            f"HTTP {status_code or 403} Authentication/Authorization Rejected at {url}: {message}",
            hint,
        )

    if "ssl" in msg_lower or "certificate" in msg_lower or "tls" in msg_lower:
        return (
            f"TLS/SSL Certificate Verification Failed for {url}: {message}",
            "Provide a valid CA cert path or disable Verify SSL if using a self-signed cert.",
        )

    if "timeout" in msg_lower or "timed out" in msg_lower:
        return (
            f"Connection Timed Out reaching {url}: {message}",
            "Confirm the host IP/port are reachable from the container and increase timeout.",
        )

    return (
        f"Unreachable or Connection Failed ({url}): {message}",
        "Verify the URL, port, firewall rules between container and host, and DNS.",
    )


def parse_setting_rows_to_overrides(
    rows: list[SystemSetting], app_secret_key: str
) -> dict[str, Any]:
    """Convert SQLite `SystemSetting` rows into a typed overrides dictionary."""
    overrides: dict[str, Any] = {}
    for row in rows:
        key = row.key
        raw_val = row.value_text
        if row.is_secret or key in SECRET_SETTING_KEYS:
            try:
                decrypted = decrypt_secret_value(raw_val, app_secret_key)
            except ValueError:
                continue
            overrides[key] = SecretStr(decrypted)
        elif key in BOOL_SETTING_KEYS:
            overrides[key] = raw_val.strip().lower() in ("true", "1", "yes")
        elif key in FLOAT_SETTING_KEYS:
            try:
                overrides[key] = float(raw_val)
            except ValueError:
                continue
        else:
            overrides[key] = raw_val
    return overrides


def sync_runtime_cache_and_build_view(
    base_settings: Settings,
    rows: list[SystemSetting],
) -> IntegrationSettingsView:
    """Update the in-memory runtime cache from `rows` and return `IntegrationSettingsView`."""
    if rows:
        overrides = parse_setting_rows_to_overrides(
            rows, base_settings.app_secret_key.get_secret_value()
        )
        set_runtime_overrides(overrides)
    else:
        clear_runtime_overrides()

    effective = apply_runtime_overrides(base_settings)
    has_opn_key = bool(effective.opnsense_api_key.get_secret_value().strip())
    has_opn_secret = bool(effective.opnsense_api_secret.get_secret_value().strip())
    has_es_key = bool(effective.elasticsearch_api_key.get_secret_value().strip())

    latest_row = max(rows, key=lambda r: r.updated_at) if rows else None
    return IntegrationSettingsView(
        source="ui_override" if rows else "env",
        opnsense_base_url=effective.opnsense_base_url,
        has_opnsense_api_key=has_opn_key,
        opnsense_api_key_masked=MASKED_SECRET_PLACEHOLDER if has_opn_key else "",
        has_opnsense_api_secret=has_opn_secret,
        opnsense_api_secret_masked=MASKED_SECRET_PLACEHOLDER if has_opn_secret else "",
        opnsense_verify_ssl=effective.opnsense_verify_ssl,
        opnsense_ca_cert_path=effective.opnsense_ca_cert_path,
        opnsense_timeout_seconds=effective.opnsense_timeout_seconds,
        opnsense_protected_ips=effective.opnsense_protected_ips,
        elasticsearch_url=effective.elasticsearch_url,
        has_elasticsearch_api_key=has_es_key,
        elasticsearch_api_key_masked=MASKED_SECRET_PLACEHOLDER if has_es_key else "",
        elasticsearch_verify_ssl=effective.elasticsearch_verify_ssl,
        elasticsearch_ca_cert_path=effective.elasticsearch_ca_cert_path,
        elasticsearch_timeout_seconds=effective.elasticsearch_timeout_seconds,
        elasticsearch_index_patterns=effective.elasticsearch_index_patterns,
        updated_by=latest_row.updated_by if latest_row else None,
        updated_at=latest_row.updated_at.isoformat() if latest_row else None,
    )


def build_temporary_settings_for_test(
    base_settings: Settings,
    payload: IntegrationSettingsUpdatePayload,
) -> Settings:
    """Construct a temporary `Settings` object combining active settings with form values."""
    effective = apply_runtime_overrides(base_settings)
    updates: dict[str, Any] = {}

    if payload.opnsense_base_url is not None and payload.opnsense_base_url.strip():
        updates["opnsense_base_url"] = validate_and_normalize_url(
            payload.opnsense_base_url, "opnsense_base_url"
        )
    if (
        payload.opnsense_api_key is not None
        and payload.opnsense_api_key.strip()
        and payload.opnsense_api_key.strip() != MASKED_SECRET_PLACEHOLDER
    ):
        updates["opnsense_api_key"] = SecretStr(payload.opnsense_api_key.strip())
    if (
        payload.opnsense_api_secret is not None
        and payload.opnsense_api_secret.strip()
        and payload.opnsense_api_secret.strip() != MASKED_SECRET_PLACEHOLDER
    ):
        updates["opnsense_api_secret"] = SecretStr(payload.opnsense_api_secret.strip())
    if payload.opnsense_verify_ssl is not None:
        updates["opnsense_verify_ssl"] = bool(payload.opnsense_verify_ssl)
    if payload.opnsense_ca_cert_path is not None:
        updates["opnsense_ca_cert_path"] = payload.opnsense_ca_cert_path.strip()
    if payload.opnsense_timeout_seconds is not None:
        updates["opnsense_timeout_seconds"] = float(payload.opnsense_timeout_seconds)
    if (
        payload.opnsense_protected_ips is not None
        and payload.opnsense_protected_ips.strip()
    ):
        updates["opnsense_protected_ips"] = validate_and_normalize_protected_ips(
            payload.opnsense_protected_ips
        )

    if payload.elasticsearch_url is not None and payload.elasticsearch_url.strip():
        updates["elasticsearch_url"] = validate_and_normalize_url(
            payload.elasticsearch_url, "elasticsearch_url"
        )
    if (
        payload.elasticsearch_api_key is not None
        and payload.elasticsearch_api_key.strip()
        and payload.elasticsearch_api_key.strip() != MASKED_SECRET_PLACEHOLDER
    ):
        updates["elasticsearch_api_key"] = SecretStr(
            payload.elasticsearch_api_key.strip()
        )
    if payload.elasticsearch_verify_ssl is not None:
        updates["elasticsearch_verify_ssl"] = bool(payload.elasticsearch_verify_ssl)
    if payload.elasticsearch_ca_cert_path is not None:
        updates["elasticsearch_ca_cert_path"] = payload.elasticsearch_ca_cert_path.strip()
    if payload.elasticsearch_timeout_seconds is not None:
        updates["elasticsearch_timeout_seconds"] = float(
            payload.elasticsearch_timeout_seconds
        )
    if (
        payload.elasticsearch_index_patterns is not None
        and payload.elasticsearch_index_patterns.strip()
    ):
        updates["elasticsearch_index_patterns"] = (
            payload.elasticsearch_index_patterns.strip()
        )

    return effective.model_copy(update=updates)


def prepare_persisted_settings_rows(
    existing_rows_list: list[SystemSetting],
    base_settings: Settings,
    payload: IntegrationSettingsUpdatePayload,
    *,
    actor: str,
) -> tuple[list[SystemSetting], AuditLog]:
    """Synchronously prepare updated/new `SystemSetting` rows and `AuditLog` (`FB-P9-002`)."""
    existing_rows = {r.key: r for r in existing_rows_list}
    if existing_rows:
        set_runtime_overrides(
            parse_setting_rows_to_overrides(
                existing_rows_list,
                base_settings.app_secret_key.get_secret_value(),
            )
        )
    merged = build_temporary_settings_for_test(base_settings, payload)
    secret_key_str = base_settings.app_secret_key.get_secret_value()

    values_to_persist: dict[str, tuple[str, bool]] = {
        "opnsense_base_url": (merged.opnsense_base_url, False),
        "opnsense_api_key": (
            encrypt_secret_value(
                merged.opnsense_api_key.get_secret_value(), secret_key_str
            ),
            True,
        ),
        "opnsense_api_secret": (
            encrypt_secret_value(
                merged.opnsense_api_secret.get_secret_value(), secret_key_str
            ),
            True,
        ),
        "opnsense_verify_ssl": (
            "true" if merged.opnsense_verify_ssl else "false",
            False,
        ),
        "opnsense_ca_cert_path": (merged.opnsense_ca_cert_path, False),
        "opnsense_timeout_seconds": (str(merged.opnsense_timeout_seconds), False),
        "opnsense_protected_ips": (merged.opnsense_protected_ips, False),
        "elasticsearch_url": (merged.elasticsearch_url, False),
        "elasticsearch_api_key": (
            encrypt_secret_value(
                merged.elasticsearch_api_key.get_secret_value(), secret_key_str
            ),
            True,
        ),
        "elasticsearch_verify_ssl": (
            "true" if merged.elasticsearch_verify_ssl else "false",
            False,
        ),
        "elasticsearch_ca_cert_path": (merged.elasticsearch_ca_cert_path, False),
        "elasticsearch_timeout_seconds": (
            str(merged.elasticsearch_timeout_seconds),
            False,
        ),
        "elasticsearch_index_patterns": (
            merged.elasticsearch_index_patterns,
            False,
        ),
    }

    new_rows: list[SystemSetting] = []
    for key, (val_str, is_sec) in values_to_persist.items():
        if key in existing_rows:
            row = existing_rows[key]
            row.value_text = val_str
            row.is_secret = is_sec
            row.updated_by = actor
        else:
            new_rows.append(
                SystemSetting(
                    key=key,
                    value_text=val_str,
                    is_secret=is_sec,
                    updated_by=actor,
                )
            )

    audit = AuditLog(
        actor=actor,
        action="settings.update",
        audit_label="SETTINGS_CHANGE",
        target="integration_settings",
        status="success",
        details=(
            f"Updated runtime integration settings "
            f"(OPNsense={merged.opnsense_base_url}, ES={merged.elasticsearch_url})"
        ),
    )
    return new_rows, audit


def evaluate_connectivity_diagnostic_result(
    service: Literal["opnsense", "elasticsearch"],
    target_url: str,
    health: ServiceHealthStatus,
    *,
    actor: str,
) -> tuple[ConnectivityTestResponse, AuditLog]:
    """Synchronously evaluate `ServiceHealthStatus` and build diagnostic response + `AuditLog`."""
    details_dict = dict(health.details or {})
    if health.status == "unhealthy":
        err_diag, hint = build_troubleshooting_hint(
            service, health.message, details_dict
        )
        audit = AuditLog(
            actor=actor,
            action=f"diagnostic.{service}",
            audit_label="DIAGNOSTIC_ERROR",
            target=target_url,
            status="failed",
            details=f"{err_diag} | Hint: {hint}",
        )
        return (
            ConnectivityTestResponse(
                service=service,
                reachable=False,
                status="unhealthy",
                latency_ms=health.latency_ms,
                message=health.message,
                error_diagnostic=err_diag,
                troubleshooting_hint=hint,
                details=details_dict,
            ),
            audit,
        )

    audit = AuditLog(
        actor=actor,
        action=f"diagnostic.{service}",
        audit_label="SETTINGS_CHANGE",
        target=target_url,
        status="success",
        details=health.message,
    )
    return (
        ConnectivityTestResponse(
            service=service,
            reachable=True,
            status=health.status,
            latency_ms=health.latency_ms,
            message=health.message,
            error_diagnostic=None,
            troubleshooting_hint=None,
            details=details_dict,
        ),
        audit,
    )


async def load_runtime_settings_from_db(
    db: AsyncSession, base_settings: Settings
) -> dict[str, Any]:
    """Load persisted `SystemSetting` rows from SQLite into the in-memory cache."""
    rows = list((await db.execute(select(SystemSetting))).scalars().all())
    sync_runtime_cache_and_build_view(base_settings, rows)
    return parse_setting_rows_to_overrides(
        rows, base_settings.app_secret_key.get_secret_value()
    )


async def get_integration_settings(
    db: AsyncSession, base_settings: Settings
) -> IntegrationSettingsView:
    """Return the active integration settings (`.env` merged with SQLite overrides)."""
    rows = list((await db.execute(select(SystemSetting))).scalars().all())
    return sync_runtime_cache_and_build_view(base_settings, rows)


async def update_integration_settings(
    db: AsyncSession,
    base_settings: Settings,
    payload: IntegrationSettingsUpdatePayload,
    *,
    actor: str,
) -> IntegrationSettingsView:
    """Validate and persist OPNsense & Elasticsearch settings in SQLite (`FB-P9-002`)."""
    existing_rows_list = list(
        (await db.execute(select(SystemSetting))).scalars().all()
    )
    new_rows, audit = prepare_persisted_settings_rows(
        existing_rows_list, base_settings, payload, actor=actor
    )
    for row in new_rows:
        db.add(row)
    db.add(audit)
    await db.commit()
    return await get_integration_settings(db, base_settings)


async def reset_integration_settings_to_env(
    db: AsyncSession,
    base_settings: Settings,
    *,
    actor: str,
) -> IntegrationSettingsView:
    """Clear all SQLite runtime settings overrides and revert to `.env` defaults (`FB-P9-002`)."""
    await db.execute(delete(SystemSetting))
    db.add(
        AuditLog(
            actor=actor,
            action="settings.reset",
            audit_label="SETTINGS_CHANGE",
            target="integration_settings",
            status="success",
            details="Reset runtime integration settings to .env defaults",
        )
    )
    await db.commit()
    return sync_runtime_cache_and_build_view(base_settings, [])


async def run_connectivity_diagnostic(
    db: AsyncSession,
    base_settings: Settings,
    service: Literal["opnsense", "elasticsearch"],
    payload: IntegrationSettingsUpdatePayload,
    *,
    actor: str,
) -> ConnectivityTestResponse:
    """Execute a live connectivity check for OPNsense or Elasticsearch (`FB-P9-002`)."""
    await load_runtime_settings_from_db(db, base_settings)
    temp_settings = build_temporary_settings_for_test(base_settings, payload)

    if service == "opnsense":
        target_url = temp_settings.opnsense_base_url
        health = await OPNsenseClient(temp_settings).check_health()
    else:
        target_url = temp_settings.elasticsearch_url
        health = await ElasticsearchServiceClient(temp_settings).check_health()

    resp, audit = evaluate_connectivity_diagnostic_result(
        service, target_url, health, actor=actor
    )
    db.add(audit)
    await db.commit()
    return resp
