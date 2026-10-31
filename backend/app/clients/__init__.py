"""External service clients (OPNsense 26.7.7-amd64 and Elasticsearch 9.4.3)."""

from app.clients.elasticsearch import ElasticsearchServiceClient, ServiceHealthStatus
from app.clients.opnsense import OPNsenseClient

__all__ = ["ElasticsearchServiceClient", "OPNsenseClient", "ServiceHealthStatus"]
