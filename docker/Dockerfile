# ==============================================================================
# Stage 1: Build React 19 + TypeScript + Tailwind v4 SPA Bundle
# ==============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python 3.12 FastAPI Runtime Serving API + Compiled SPA
# ==============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SQLITE_DB_PATH=/app/data/gateway.db \
    DATABASE_URL=sqlite+aiosqlite:////app/data/gateway.db \
    PYTHONPATH=/app/backend

RUN groupadd --gid 10001 gateway \
    && useradd --uid 10001 --gid gateway --shell /usr/sbin/nologin --create-home gateway \
    && mkdir -p /app/data /app/backend /app/frontend/dist \
    && chown -R gateway:gateway /app

WORKDIR /app/backend

COPY --chown=gateway:gateway backend/pyproject.toml ./pyproject.toml
COPY --chown=gateway:gateway backend/alembic.ini ./alembic.ini
COPY --chown=gateway:gateway backend/alembic ./alembic
COPY --chown=gateway:gateway backend/app ./app

RUN pip install --upgrade pip \
    && pip install .

COPY --from=frontend-builder --chown=gateway:gateway /build/frontend/dist /app/frontend/dist

USER gateway

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/system/ping', timeout=3)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

