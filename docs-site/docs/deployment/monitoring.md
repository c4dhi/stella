---
sidebar_position: 3
title: Monitoring
description: Set up observability for STELLA
---

# Monitoring

Comprehensive monitoring is essential for running STELLA in production. This guide covers metrics, logging, tracing, and alerting.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Monitoring Stack                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Prometheus  │  │    Loki     │  │   Jaeger    │         │
│  │  (Metrics)  │  │  (Logging)  │  │  (Tracing)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│                   ┌─────────────┐                           │
│                   │   Grafana   │                           │
│                   │ (Dashboards)│                           │
│                   └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

## Metrics (Prometheus)

### Backend Metrics

STELLA exposes Prometheus metrics at `/metrics`:

```typescript
// Key metrics exposed
stella_http_requests_total         // Total HTTP requests
stella_http_request_duration       // Request latency histogram
stella_sessions_active             // Current active sessions
stella_sessions_created_total      // Total sessions created
stella_agent_pods_active           // Running agent pods
stella_database_connections        // DB connection pool status
```

### Agent Metrics

```python
# Agent metrics (Python)
from prometheus_client import Counter, Histogram, Gauge

messages_processed = Counter(
    'stella_agent_messages_total',
    'Total messages processed',
    ['agent_type', 'direction']
)

response_latency = Histogram(
    'stella_agent_response_seconds',
    'Response generation latency',
    ['agent_type'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
)

active_conversations = Gauge(
    'stella_agent_conversations_active',
    'Active conversations',
    ['agent_type']
)
```

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  # Backend API
  - job_name: 'stella-backend'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: ['ai-agents']
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: session-management-server
        action: keep

  # Agent pods
  - job_name: 'stella-agents'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: ['ai-agents']
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: stella-agent
        action: keep
```

### Key Dashboards

**System Overview:**
- Active sessions
- Request rate
- Error rate
- Average latency

**Agent Performance:**
- Response latency distribution
- Messages per minute
- Tool execution time
- STT/TTS latency

**Infrastructure:**
- Pod resource usage
- Database connections
- Node resource utilization

## Logging (Structured)

### Backend Logging

```typescript
// Structured JSON logging
import { Logger } from '@nestjs/common';

this.logger.log({
  message: 'Session created',
  sessionId: session.id,
  projectId: session.projectId,
  agentType: session.agentType,
  duration_ms: Date.now() - startTime
});
```

### Agent Logging

```python
import structlog

logger = structlog.get_logger()

logger.info(
    "message_processed",
    session_id=self.session_id,
    speaker="user",
    text_length=len(text),
    processing_time_ms=processing_time * 1000
)
```

### Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Session created",
  "service": "stella-backend",
  "session_id": "abc123",
  "project_id": "proj456",
  "agent_type": "stella-agent",
  "duration_ms": 150,
  "trace_id": "trace789"
}
```

### Loki Configuration

```yaml
# Promtail config for Kubernetes
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    pipeline_stages:
      - json:
          expressions:
            level: level
            session_id: session_id
            trace_id: trace_id
      - labels:
          level:
          session_id:
```

## Tracing (OpenTelemetry)

### Backend Tracing

```typescript
// Instrument with OpenTelemetry
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('stella-backend');

async function createSession(dto: CreateSessionDto) {
  const span = tracer.startSpan('session.create');

  try {
    span.setAttribute('project_id', dto.projectId);
    span.setAttribute('agent_type', dto.agentType);

    const session = await this.prisma.session.create({ ... });

    span.setAttribute('session_id', session.id);
    return session;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

### Agent Tracing

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

async def generate_response(self, text: str):
    with tracer.start_as_current_span("generate_response") as span:
        span.set_attribute("input_length", len(text))

        # LLM call
        with tracer.start_span("llm_call"):
            response = await self.openai.chat.completions.create(...)

        span.set_attribute("output_length", len(response))
        return response
```

### Jaeger Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaeger
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jaeger
  template:
    spec:
      containers:
        - name: jaeger
          image: jaegertracing/all-in-one:latest
          ports:
            - containerPort: 16686  # UI
            - containerPort: 4318   # OTLP HTTP
          env:
            - name: COLLECTOR_OTLP_ENABLED
              value: "true"
```

## Alerting

### Alert Rules

```yaml
# prometheus-rules.yml
groups:
  - name: stella-alerts
    rules:
      # High error rate
      - alert: HighErrorRate
        expr: |
          sum(rate(stella_http_requests_total{status=~"5.."}[5m]))
          / sum(rate(stella_http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: High error rate detected
          description: Error rate is above 5%

      # Slow responses
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            rate(stella_http_request_duration_bucket[5m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: High latency detected
          description: P95 latency is above 2 seconds

      # Too many active sessions
      - alert: HighSessionCount
        expr: stella_sessions_active > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: High number of active sessions

      # Agent pod failures
      - alert: AgentPodFailures
        expr: |
          increase(kube_pod_container_status_restarts_total{
            namespace="ai-agents",
            container="agent"
          }[1h]) > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: Agent pods restarting frequently
```

### Alertmanager Configuration

```yaml
# alertmanager.yml
route:
  receiver: 'slack'
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'

receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/...'
        channel: '#stella-alerts'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: '...'
```

## Grafana Dashboards

### Dashboard JSON

```json
{
  "dashboard": {
    "title": "STELLA Overview",
    "panels": [
      {
        "title": "Active Sessions",
        "type": "stat",
        "targets": [{
          "expr": "stella_sessions_active"
        }]
      },
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [{
          "expr": "rate(stella_http_requests_total[5m])"
        }]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [{
          "expr": "sum(rate(stella_http_requests_total{status=~\"5..\"}[5m])) / sum(rate(stella_http_requests_total[5m]))"
        }]
      },
      {
        "title": "Response Latency",
        "type": "heatmap",
        "targets": [{
          "expr": "rate(stella_http_request_duration_bucket[5m])"
        }]
      }
    ]
  }
}
```

## Health Checks

### Kubernetes Probes

```yaml
spec:
  containers:
    - name: backend
      livenessProbe:
        httpGet:
          path: /health
          port: 3000
        initialDelaySeconds: 30
        periodSeconds: 10

      readinessProbe:
        httpGet:
          path: /health/ready
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
```

### Health Endpoints

```typescript
// Backend health endpoints
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'healthy', timestamp: new Date() };
  }

  @Get('ready')
  async ready() {
    // Check database connection
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }
}
```

## Next Steps

- [Production Checklist](/docs/deployment/production-checklist) - Go-live checklist
- [Kubernetes Deployment](/docs/deployment/kubernetes) - Deployment guide
