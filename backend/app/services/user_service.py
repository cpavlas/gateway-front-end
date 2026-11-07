"""User account management, NGINX-style first-boot admin setup, and RBAC rules (Phase 9)."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    SetupAdminRequest,
    SetupStatusResponse,
    hash_password,
    is_protected_admin_username,
    verify_admin_credentials,
    verify_password_hash,
)
from app.config import Settings
from app.models import VALID_USER_ROLES, VALID_USER_THEMES, AuditLog, User

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")


class UserItem(BaseModel):
    """Serialized user account representation (never exposes password_hash)."""

    id: int
    username: str
    role: Literal["admin", "operator"]
    is_active: bool
    is_protected_admin: bool
    theme_preference: str
    created_at: str
    updated_at: str


class UserListResponse(BaseModel):
    """Response payload for GET /api/v1/users."""

    users: list[UserItem]


class UserCreatePayload(BaseModel):
    """Payload for POST /api/v1/users."""

    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["admin", "operator"] = "operator"
    is_active: bool = True
    theme_preference: str = "default"


class UserUpdatePayload(BaseModel):
    """Payload for PATCH /api/v1/users/{user_id}."""

    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: Literal["admin", "operator"] | None = None
    is_active: bool | None = None
    theme_preference: str | None = None


def normalize_username(raw_username: str) -> str:
    """Validate and normalize a username string."""
    cleaned = (raw_username or "").strip()
    if not _USERNAME_RE.match(cleaned):
        raise ValueError(
            "Username must be 3..64 chars (letters, numbers, '.', '_', or '-')."
        )
    if cleaned.lower() == "admin":
        return "admin"
    return cleaned


def normalize_user_role(role: str | None) -> Literal["admin", "operator"]:
    """Validate and normalize a user role ('admin' or 'operator')."""
    cleaned = (role or "operator").strip().lower()
    if cleaned not in VALID_USER_ROLES:
        raise ValueError(
            f"Unsupported role '{role}'. Allowed roles: {sorted(VALID_USER_ROLES)}"
        )
    return "admin" if cleaned == "admin" else "operator"


def normalize_theme_preference(theme: str | None) -> str:
    """Validate and normalize a user theme preference ('default', 'crimson', 'ocean')."""
    cleaned = (theme or "default").strip().lower()
    if cleaned not in VALID_USER_THEMES:
        raise ValueError(
            f"Unsupported theme '{theme}'. Allowed themes: {sorted(VALID_USER_THEMES)}"
        )
    return cleaned


def validate_initial_admin_passwords(
    password: str, confirm_password: str | None = None
) -> str:
    """Validate the initial first-boot admin password and optional confirmation."""
    cleaned = (password or "").strip()
    if len(cleaned) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    if confirm_password is not None and cleaned != confirm_password.strip():
        raise ValueError("Password and confirmation password do not match.")
    return cleaned


def enforce_protected_admin_mutation(
    target_username: str,
    *,
    action: Literal["update", "delete"],
    new_role: str | None = None,
    new_is_active: bool | None = None,
) -> None:
    """Raise PermissionError if attempting to delete, disable, or demote the built-in admin."""
    if not is_protected_admin_username(target_username):
        return
    if action == "delete":
        raise PermissionError("The default admin account cannot be deleted.")
    if new_is_active is False:
        raise PermissionError("The default admin account cannot be disabled.")
    if new_role is not None and new_role.strip().lower() != "admin":
        raise PermissionError(
            "The default admin account must retain the 'admin' role."
        )


def build_user_item(user: User) -> UserItem:
    """Convert a SQLAlchemy `User` row into a `UserItem` response model."""
    role_lit: Literal["admin", "operator"] = (
        "admin" if user.role == "admin" else "operator"
    )
    return UserItem(
        id=user.id,
        username=user.username,
        role=role_lit,
        is_active=bool(user.is_active),
        is_protected_admin=is_protected_admin_username(user.username),
        theme_preference=user.theme_preference or "default",
        created_at=user.created_at.isoformat(),
        updated_at=user.updated_at.isoformat(),
    )


def build_sorted_user_list_response(rows: list[User]) -> UserListResponse:
    """Sort `User` rows with `admin` first and serialize into `UserListResponse`."""
    sorted_rows = sorted(
        rows,
        key=lambda u: (
            0 if is_protected_admin_username(u.username) else 1,
            u.username.lower(),
        ),
    )
    return UserListResponse(users=[build_user_item(r) for r in sorted_rows])


def prepare_seeded_admin_user(settings: Settings) -> User | None:
    """Build a seeded `User` ORM object from `.env` settings if `ADMIN_PASSWORD` is configured."""
    if not settings.has_configured_env_admin_password:
        return None
    raw_secret = settings.admin_password
    raw_pwd = (
        raw_secret.get_secret_value()
        if isinstance(raw_secret, SecretStr)
        else str(raw_secret)
    ).strip()
    pwd_hash = raw_pwd if raw_pwd.startswith("$argon2") else hash_password(raw_pwd)
    return User(
        username="admin",
        password_hash=pwd_hash,
        role="admin",
        is_active=True,
        theme_preference="default",
    )


def prepare_initial_setup_admin(
    payload: SetupAdminRequest, client_ip: str
) -> tuple[User, AuditLog]:
    """Build the initial `admin` `User` and `AuditLog` for first-boot setup (`FB-P9-001`)."""
    clean_pwd = validate_initial_admin_passwords(
        payload.password, payload.confirm_password
    )
    admin_user = User(
        username="admin",
        password_hash=hash_password(clean_pwd),
        role="admin",
        is_active=True,
        theme_preference="default",
    )
    audit = AuditLog(
        actor="admin",
        action="auth.setup_admin",
        audit_label="AUTH_EVENT",
        target=client_ip,
        status="success",
        details="Initial admin password created on first-boot setup",
    )
    return admin_user, audit


def evaluate_user_authentication(
    user_row: User | None,
    username: str,
    password: str,
    settings: Settings,
) -> User | None:
    """Synchronously evaluate credentials against a `User` row or `.env` fallback."""
    cleaned_user = (username or "").strip()
    if user_row is not None:
        if not user_row.is_active:
            raise PermissionError("This user account has been disabled.")
        if verify_password_hash(password, user_row.password_hash):
            return user_row
        if is_protected_admin_username(user_row.username) and verify_admin_credentials(
            cleaned_user, password, settings
        ):
            return user_row
        return None
    return None


def prepare_created_user(
    payload: UserCreatePayload,
    existing_user: User | None,
    *,
    actor: str,
) -> tuple[User, AuditLog]:
    """Validate and construct a new `User` and `AuditLog` (`FB-P9-003`)."""
    clean_username = normalize_username(payload.username)
    if existing_user is not None:
        raise ValueError(f"User '{clean_username}' already exists.")
    clean_role = normalize_user_role(payload.role)
    clean_theme = normalize_theme_preference(payload.theme_preference)
    pwd_hash = hash_password(payload.password)

    if is_protected_admin_username(clean_username):
        clean_role = "admin"
        is_active = True
    else:
        is_active = bool(payload.is_active)

    new_user = User(
        username=clean_username,
        password_hash=pwd_hash,
        role=clean_role,
        is_active=is_active,
        theme_preference=clean_theme,
    )
    audit = AuditLog(
        actor=actor,
        action="user.create",
        audit_label="USER_MGMT",
        target=clean_username,
        status="success",
        details=f"Created user '{clean_username}' with role '{clean_role}'",
    )
    return new_user, audit


def apply_user_updates(
    user_row: User | None,
    user_id: int,
    payload: UserUpdatePayload,
    *,
    actor: str,
) -> tuple[User, AuditLog]:
    """Apply validated updates to `user_row` and return `(user_row, audit_log)`."""
    if user_row is None:
        raise LookupError(f"User ID {user_id} not found.")

    enforce_protected_admin_mutation(
        user_row.username,
        action="update",
        new_role=payload.role,
        new_is_active=payload.is_active,
    )

    changes: list[str] = []
    if payload.password is not None:
        user_row.password_hash = hash_password(payload.password)
        changes.append("password updated")
    if payload.role is not None:
        user_row.role = normalize_user_role(payload.role)
        changes.append(f"role={user_row.role}")
    if payload.is_active is not None:
        user_row.is_active = bool(payload.is_active)
        changes.append(f"is_active={user_row.is_active}")
    if payload.theme_preference is not None:
        user_row.theme_preference = normalize_theme_preference(payload.theme_preference)
        changes.append(f"theme={user_row.theme_preference}")

    details = (
        f"Updated user '{user_row.username}' ({', '.join(changes)})"
        if changes
        else f"Updated user '{user_row.username}'"
    )
    audit = AuditLog(
        actor=actor,
        action="user.update",
        audit_label="USER_MGMT",
        target=user_row.username,
        status="success",
        details=details,
    )
    return user_row, audit


def prepare_deleted_user_audit(
    user_row: User | None, user_id: int, *, actor: str
) -> tuple[User, AuditLog, dict[str, object]]:
    """Validate user deletion and construct the audit log and response summary."""
    if user_row is None:
        raise LookupError(f"User ID {user_id} not found.")
    enforce_protected_admin_mutation(user_row.username, action="delete")
    deleted_username = user_row.username
    audit = AuditLog(
        actor=actor,
        action="user.delete",
        audit_label="USER_MGMT",
        target=deleted_username,
        status="success",
        details=f"Deleted user '{deleted_username}'",
    )
    return (
        user_row,
        audit,
        {"deleted_user_id": user_id, "username": deleted_username},
    )


async def ensure_default_admin_seeded(
    db: AsyncSession, settings: Settings
) -> User | None:
    """Seed the built-in `admin` user into SQLite if `.env` defines a real ADMIN_PASSWORD."""
    admin_row = (
        await db.execute(select(User).where(func.lower(User.username) == "admin"))
    ).scalar_one_or_none()
    if admin_row is not None:
        return admin_row

    seeded = prepare_seeded_admin_user(settings)
    if seeded is None:
        return None
    db.add(seeded)
    await db.commit()
    await db.refresh(seeded)
    return seeded


async def get_setup_status(
    db: AsyncSession, settings: Settings
) -> SetupStatusResponse:
    """Return whether the platform requires first-boot `admin` password creation (`FB-P9-001`)."""
    seeded = await ensure_default_admin_seeded(db, settings)
    if seeded is not None:
        return SetupStatusResponse(
            needs_initial_setup=False, admin_username=seeded.username
        )

    total_users = (
        await db.execute(select(func.count()).select_from(User))
    ).scalar_one()
    return SetupStatusResponse(
        needs_initial_setup=(int(total_users or 0) == 0),
        admin_username="admin",
    )


async def setup_initial_admin_account(
    db: AsyncSession,
    payload: SetupAdminRequest,
    settings: Settings,
    *,
    client_ip: str = "unknown",
) -> User:
    """Create the initial `admin` account on first boot when no users exist yet (`FB-P9-001`)."""
    status_resp = await get_setup_status(db, settings)
    if not status_resp.needs_initial_setup:
        raise ValueError("Initial admin password setup has already been completed.")

    admin_user, audit = prepare_initial_setup_admin(payload, client_ip)
    db.add(admin_user)
    db.add(audit)
    await db.commit()
    await db.refresh(admin_user)
    return admin_user


async def authenticate_user_account(
    db: AsyncSession,
    username: str,
    password: str,
    settings: Settings,
) -> User | None:
    """Authenticate a user against SQLite `users` (with `.env` fallback for `admin`)."""
    await ensure_default_admin_seeded(db, settings)
    cleaned_user = (username or "").strip()
    if not cleaned_user:
        return None

    user_row = (
        await db.execute(
            select(User).where(func.lower(User.username) == cleaned_user.lower())
        )
    ).scalar_one_or_none()

    return evaluate_user_authentication(user_row, cleaned_user, password, settings)


async def list_all_users(
    db: AsyncSession, settings: Settings
) -> UserListResponse:
    """Return all user accounts sorted with `admin` first, then alphabetically."""
    await ensure_default_admin_seeded(db, settings)
    rows = list((await db.execute(select(User))).scalars().all())
    return build_sorted_user_list_response(rows)


async def create_user_account(
    db: AsyncSession,
    payload: UserCreatePayload,
    *,
    actor: str,
) -> UserItem:
    """Create a new platform user account (`FB-P9-003`)."""
    clean_username = normalize_username(payload.username)
    existing = (
        await db.execute(
            select(User).where(func.lower(User.username) == clean_username.lower())
        )
    ).scalar_one_or_none()
    new_user, audit = prepare_created_user(payload, existing, actor=actor)
    db.add(new_user)
    db.add(audit)
    await db.commit()
    await db.refresh(new_user)
    return build_user_item(new_user)


async def update_user_account(
    db: AsyncSession,
    user_id: int,
    payload: UserUpdatePayload,
    *,
    actor: str,
) -> UserItem:
    """Update a user's password, role, active state, or theme preference (`FB-P9-003`)."""
    user_row = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    updated_row, audit = apply_user_updates(user_row, user_id, payload, actor=actor)
    db.add(audit)
    await db.commit()
    await db.refresh(updated_row)
    return build_user_item(updated_row)


async def delete_user_account(
    db: AsyncSession,
    user_id: int,
    *,
    actor: str,
) -> dict[str, object]:
    """Delete a user account while protecting the default `admin` account (`FB-P9-003`)."""
    user_row = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    target_row, audit, summary = prepare_deleted_user_audit(
        user_row, user_id, actor=actor
    )
    await db.delete(target_row)
    db.add(audit)
    await db.commit()
    return summary



class UserPreferencesUpdatePayload(BaseModel):
    """Payload for PATCH /api/v1/auth/preferences (`FB-P11-002`)."""

    theme_preference: str = Field(default="default", min_length=1, max_length=32)


def apply_self_theme_preference(
    user_row: User | None,
    username: str,
    raw_theme: str,
) -> tuple[str, AuditLog]:
    """Validate and apply a user's self-selected color theme (`FB-P11-002`)."""
    clean_theme = normalize_theme_preference(raw_theme)
    if user_row is not None:
        user_row.theme_preference = clean_theme
    audit = AuditLog(
        actor=username,
        action="user.preferences",
        audit_label="USER_MGMT",
        target=username,
        status="success",
        details=f"Updated color theme preference to '{clean_theme}'",
    )
    return clean_theme, audit


async def update_self_theme_preference(
    db: AsyncSession,
    settings: Settings,
    username: str,
    payload: UserPreferencesUpdatePayload,
) -> str:
    """Persist the signed-in user's theme preference in SQLite (`FB-P11-002`)."""
    await ensure_default_admin_seeded(db, settings)
    user_row = (
        await db.execute(
            select(User).where(func.lower(User.username) == username.lower())
        )
    ).scalar_one_or_none()
    clean_theme, audit = apply_self_theme_preference(
        user_row, username, payload.theme_preference
    )
    db.add(audit)
    await db.commit()
    return clean_theme
