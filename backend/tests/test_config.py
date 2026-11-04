"""Unit tests for .env configuration loading and validation (Step 1.2)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import DEFAULT_GATEWAY_IP, Settings


def _base_kwargs() -> dict[str, object]:
    return {
        "_env_file": None,
        "app_env": "production",
        "app_secret_key": "a" * 64,
        "admin_username": "admin",
        "admin_password": "ValidAdminPassword!123",
        "opnsense_base_url": "https://opnsense.example.local/",
        "opnsense_api_key": "opn_key",
        "opnsense_api_secret": "opn_secret",
        "opnsense_protected_ips": "192.168.1.5, 192.168.1.10",
        "elasticsearch_url": "https://elasticsearch.example.local:9200/",
        "elasticsearch_api_key": "ZXNfa2V5",
        "elasticsearch_index_patterns": "logs-pfsense.log*, logs-other*",
    }


def test_valid_settings_and_normalization() -> None:
    """Valid settings normalize URLs, enforce 192.168.1.1 protection, and parse index patterns."""
    cfg = Settings(**_base_kwargs())
    assert cfg.opnsense_base_url == "https://opnsense.example.local"
    assert cfg.elasticsearch_url == "https://elasticsearch.example.local:9200"
    assert DEFAULT_GATEWAY_IP in cfg.protected_ip_set
    assert "192.168.1.5" in cfg.protected_ip_set
    assert "192.168.1.10" in cfg.protected_ip_set
    assert cfg.es_index_pattern_list == ["logs-pfsense.log*", "logs-other*"]


def test_secrets_are_masked_in_repr() -> None:
    """SecretStr fields must never leak plaintext secrets in repr() or str()."""
    cfg = Settings(**_base_kwargs())
    rendered = repr(cfg)
    assert "ValidAdminPassword!123" not in rendered
    assert "opn_secret" not in rendered
    assert "ZXNfa2V5" not in rendered


@pytest.mark.parametrize(
    "bad_secret",
    [
        "",
        "   ",
        "short_secret_key",
        "REPLACE_WITH_64_CHAR_RANDOM_HEX",
    ],
)
def test_rejects_invalid_or_placeholder_app_secret_key(bad_secret: str) -> None:
    """APP_SECRET_KEY must reject placeholders and keys shorter than 32 characters."""
    kwargs = _base_kwargs()
    kwargs["app_secret_key"] = bad_secret
    with pytest.raises(ValidationError):
        Settings(**kwargs)


@pytest.mark.parametrize(
    "bad_password",
    [
        "",
        "   ",
        "REPLACE_WITH_STRONG_ADMIN_PASSWORD",
    ],
)
def test_empty_or_placeholder_admin_password_triggers_first_boot_setup_mode(
    bad_password: str,
) -> None:
    """Empty or placeholder ADMIN_PASSWORD enters NGINX-style first-boot setup mode (FB-P9-001)."""
    kwargs = _base_kwargs()
    kwargs["admin_password"] = bad_password
    cfg = Settings(**kwargs)
    assert cfg.has_configured_env_admin_password is False
    assert cfg.admin_password.get_secret_value() == ""


def test_rejects_invalid_protected_ip() -> None:
    """OPNSENSE_PROTECTED_IPS must reject malformed IP strings."""
    kwargs = _base_kwargs()
    kwargs["opnsense_protected_ips"] = "192.168.1.1, not-an-ip"
    with pytest.raises(ValidationError):
        Settings(**kwargs)


def test_rejects_invalid_url_scheme() -> None:
    """Base URLs must start with http:// or https://."""
    kwargs = _base_kwargs()
    kwargs["opnsense_base_url"] = "ftp://opnsense.example.local"
    with pytest.raises(ValidationError):
        Settings(**kwargs)
