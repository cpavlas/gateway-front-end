"""Async Elasticsearch 9.4.3 client wrapper targeting logs-pfsense.log* (pfSense 1.25.4)."""

from __future__ import annotations

import time
from typing import Any

from elastic_transport import TransportError
from elasticsearch import AsyncElasticsearch, AuthenticationException, AuthorizationException

from app.clients.opnsense import ServiceHealthStatus
from app.config import Settings


class ElasticsearchServiceClient:
    """Async client wrapper for Elasticsearch 9.4.3 read-only operations."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.elasticsearch_url
        self._api_key = settings.elasticsearch_api_key.get_secret_value()
        self._verify_certs = settings.elasticsearch_verify_ssl
        self._ca_certs = settings.elasticsearch_ca_cert_path.strip() or None
        self._timeout = settings.elasticsearch_timeout_seconds
        self._index_patterns = settings.es_index_pattern_list

    def create_es_client(self) -> AsyncElasticsearch:
        """Instantiate an AsyncElasticsearch v9 client."""
        kwargs: dict[str, Any] = {
            "hosts": [self._url],
            "api_key": self._api_key,
            "verify_certs": self._verify_certs,
            "request_timeout": self._timeout,
        }
        if self._ca_certs:
            kwargs["ca_certs"] = self._ca_certs
        return AsyncElasticsearch(**kwargs)

    async def check_health(self) -> ServiceHealthStatus:
        """Verify cluster connectivity and read access to configured index patterns."""
        start = time.perf_counter()
        client = self.create_es_client()
        target_pattern = ",".join(self._index_patterns)
        try:
            info_resp = await client.info()
            cluster_name = info_resp.get("cluster_name", "unknown")
            es_version = info_resp.get("version", {}).get("number", "unknown")

            count_resp = await client.count(
                index=target_pattern,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            doc_count = int(count_resp.get("count", 0))
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="healthy",
                latency_ms=elapsed,
                message=(
                    f"Elasticsearch {es_version} connected "
                    f"({doc_count:,} docs in {target_pattern})."
                ),
                details={
                    "url": self._url,
                    "cluster_name": cluster_name,
                    "version": es_version,
                    "index_patterns": self._index_patterns,
                    "document_count": doc_count,
                },
            )
        except (AuthenticationException, AuthorizationException) as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Elasticsearch auth/permission rejected: {exc.message}",
                details={"url": self._url, "status_code": exc.status_code},
            )
        except (TransportError, Exception) as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Elasticsearch connection failed: {exc.__class__.__name__}: {exc}",
                details={"url": self._url},
            )
        finally:
            await client.close()
