"""Application configuration loaded and validated from the root .env file."""

from __future__ import annotations

import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_GATEWAY_IP = "192.168.1.1"
DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./data/gateway.db"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV_PATH = REPO_ROOT / ".env"

PLACEHOLDER_ADMIN_PASSWORDS = frozenset(
    {
        "",
        "replace_with_strong_admin_password",
        "change-me-admin-password",
        "change_me_on_first_login",
        "changeme",
        "setup_on_first_login",
    }
)

_runtime_overrides: dict[str, Any] = {}


def set_runtime_overrides(overrides: dict[str, Any]) -> None:
    """Replace active in-memory runtime settings overrides loaded from SQLite."""
    global _runtime_overrides
    _runtime_overrides = dict(overrides)


def clear_runtime_overrides() -> None:
    """Clear all in-memory runtime settings overrides (reverting to .env defaults)."""
    global _runtime_overrides
    _runtime_overrides = {}


def get_runtime_overrides() -> dict[str, Any]:
    """Return a shallow copy of active in-memory runtime settings overrides."""
    return dict(_runtime_overrides)


class Settings(BaseSettings):
    """Validated runtime configuration for the Gateway Front-End backend."""

    model_config = SettingsConfigDict(
        env_file=str(DEFAULT_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # 1. Application & Admin Authentication
    app_env: Literal["development", "testing", "production"] = "production"
    app_port: int = Field(default=8080, ge=1, le=65535)
    tz: str = "America/Los_Angeles"

    app_secret_key: SecretStr
    admin_username: str = Field(default="admin", min_length=1)
    admin_password: SecretStr = Field(default=SecretStr(""))
    session_expire_minutes: int = Field(default=720, ge=5, le=43200)
    auth_rate_limit_attempts: int = Field(default=5, ge=1, le=100)
    auth_rate_limit_window_seconds: int = Field(default=60, ge=5, le=3600)

    database_url: str = DEFAULT_DATABASE_URL
    sqlite_db_path: str = ""

    # 2. OPNsense Integration (OPNsense 26.7.7-amd64)
    opnsense_base_url: str = "https://opnsense.example.local"
    opnsense_api_key: SecretStr = Field(default=SecretStr(""))
    opnsense_api_secret: SecretStr = Field(default=SecretStr(""))
    opnsense_verify_ssl: bool = True
    opnsense_ca_cert_path: str = ""
    opnsense_timeout_seconds: float = Field(default=10.0, gt=0.5, le=120.0)
    opnsense_block_alias: str = Field(default="gateway_blocked_devices", min_length=1)
    opnsense_youtube_block_alias: str = Field(
        default="gateway_youtube_blocked_devices", min_length=1
    )
    opnsense_youtube_domains_alias: str = Field(
        default="gateway_youtube_domains", min_length=1
    )
    opnsense_protected_ips: str = DEFAULT_GATEWAY_IP

    # 3. Elasticsearch 9.4.3 Integration (Elastic pfSense Integration 1.25.4)
    elasticsearch_url: str = "https://elasticsearch.example.local:9200"
    elasticsearch_api_key: SecretStr = Field(default=SecretStr(""))
    elasticsearch_verify_ssl: bool = True
    elasticsearch_ca_cert_path: str = ""
    elasticsearch_timeout_seconds: float = Field(default=15.0, gt=0.5, le=120.0)
    elasticsearch_index_patterns: str = "logs-pfsense.log*"

    @field_validator("app_secret_key")
    @classmethod
    def validate_app_secret_key(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value().strip()
        if not raw or raw == "REPLACE_WITH_64_CHAR_RANDOM_HEX":
            raise ValueError("APP_SECRET_KEY must be set to a real secret key, not a placeholder.")
        if len(raw) < 32:
            raise ValueError("APP_SECRET_KEY must be at least 32 characters long.")
        return SecretStr(raw)

    @field_validator("admin_password")
    @classmethod
    def validate_admin_password(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value().strip()
        if raw.lower() in PLACEHOLDER_ADMIN_PASSWORDS:
            return SecretStr("")
        return SecretStr(raw)

    @property
    def has_configured_env_admin_password(self) -> bool:
        """Return True if a non-placeholder ADMIN_PASSWORD was supplied in .env."""
        raw_val = (
            self.admin_password.get_secret_value()
            if isinstance(self.admin_password, SecretStr)
            else str(self.admin_password)
        )
        raw = raw_val.strip()
        return bool(raw) and raw.lower() not in PLACEHOLDER_ADMIN_PASSWORDS

    @field_validator("opnsense_base_url", "elasticsearch_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        cleaned = value.strip().rstrip("/")
        if not cleaned.startswith(("http://", "https://")):
            raise ValueError(f"URL must start with http:// or https:// (got '{value}').")
        return cleaned

    @field_validator("opnsense_protected_ips")
    @classmethod
    def validate_protected_ips(cls, value: str) -> str:
        raw_items = [item.strip() for item in value.split(",") if item.strip()]
        validated: list[str] = []
        for item in raw_items:
            try:
                ip_obj = ipaddress.ip_address(item)
            except ValueError as exc:
                raise ValueError(f"Invalid IP address in OPNSENSE_PROTECTED_IPS: '{item}'") from exc
            validated.append(str(ip_obj))
        if DEFAULT_GATEWAY_IP not in validated:
            validated.insert(0, DEFAULT_GATEWAY_IP)
        return ",".join(dict.fromkeys(validated))

    @model_validator(mode="after")
    def resolve_sqlite_db_path(self) -> Settings:
        """If SQLITE_DB_PATH is set and database_url uses the default, bind to SQLITE_DB_PATH."""
        cleaned_url = self.database_url.strip().strip("\"'")
        if cleaned_url.startswith("sqlite+aiosqlite:///app/"):
            cleaned_url = "sqlite+aiosqlite:////" + cleaned_url[len("sqlite+aiosqlite:///") :]
        self.database_url = cleaned_url
        cleaned_path = self.sqlite_db_path.strip().strip("\"'")
        if cleaned_path and self.database_url == DEFAULT_DATABASE_URL:
            posix_path = Path(cleaned_path).as_posix()
            self.database_url = f"sqlite+aiosqlite:///{posix_path}"
        return self

    @property
    def protected_ip_set(self) -> frozenset[str]:
        """Return immutable set of protected IPs (always includes DEFAULT_GATEWAY_IP)."""
        items = [ip.strip() for ip in self.opnsense_protected_ips.split(",") if ip.strip()]
        items.append(DEFAULT_GATEWAY_IP)
        return frozenset(items)

    @property
    def es_index_pattern_list(self) -> list[str]:
        """Return list of configured Elasticsearch index/data-stream patterns."""
        patterns = [p.strip() for p in self.elasticsearch_index_patterns.split(",") if p.strip()]
        return patterns or ["logs-pfsense.log*"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()  # type: ignore[call-arg]


def apply_runtime_overrides(base_settings: Settings) -> Settings:
    """Return a `Settings` instance with active SQLite UI overrides applied over `.env` defaults."""
    if not _runtime_overrides:
        return base_settings
    updates: dict[str, Any] = {}
    for key, val in _runtime_overrides.items():
        if key in (
            "opnsense_api_key",
            "opnsense_api_secret",
            "elasticsearch_api_key",
        ):
            updates[key] = val if isinstance(val, SecretStr) else SecretStr(str(val))
        else:
            updates[key] = val
    return base_settings.model_copy(update=updates)
