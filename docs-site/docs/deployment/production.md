---
sidebar_position: 2
title: "🏭 Production"
---

# 🏭 Production Deployment

Guide for deploying STELLA in production environments.

## Production Checklist

Before deploying to production:

- [ ] DNS records configured and verified
- [ ] SSL certificates installed and auto-renewing
- [ ] Backend `.env` configured for production
- [ ] Frontend built with production URLs
- [ ] Nginx configuration tested
- [ ] Firewall allows ports 80, 443
- [ ] Services running with process manager (PM2/systemd)
- [ ] CORS configured for specific domain
- [ ] Internal APIs not publicly accessible
- [ ] Monitoring and logging configured
- [ ] Backup strategy in place
- [ ] All default passwords changed

## Production Considerations

### Use a Real Kubernetes Cluster

For production, use managed Kubernetes:
- **GKE** (Google Kubernetes Engine)
- **EKS** (Amazon Elastic Kubernetes Service)
- **AKS** (Azure Kubernetes Service)

### Use Managed PostgreSQL

Replace the in-cluster PostgreSQL with a managed database:
- Google Cloud SQL
- Amazon RDS
- Azure Database for PostgreSQL

Update your connection string:

```bash
DATABASE_URL=postgresql://user:password@your-managed-db.region.rds.amazonaws.com:5432/stella
```

### Secure Secrets

Use a secrets management solution:
- HashiCorp Vault
- AWS Secrets Manager
- Google Secret Manager
- Azure Key Vault

### Enable SSL/TLS

All services should use TLS:

```bash
# Backend
PUBLIC_SERVER_URL=https://api.yourdomain.com
PUBLIC_LIVEKIT_URL=wss://livekit.yourdomain.com
```

### Configure Monitoring

Set up observability:
- **Prometheus** for metrics
- **Grafana** for dashboards
- **Loki** or **ELK** for logs
- **Jaeger** for tracing

### Autoscaling

Configure Horizontal Pod Autoscaler:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: ai-agents
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: session-management-server
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Deployment Modes

### Background Mode

Run STELLA in daemon mode for production:

```bash
./scripts/start-k8s.sh --production --daemon
```

This:
- Runs in the background
- Survives SSH logout
- Automatically restarts on failure

### Monitoring Daemon

Check daemon status:

```bash
# View logs
tail -f /tmp/stella-ai-k8s/stella-ai-k8s.log

# Check port-forwards
./scripts/monitor-port-forwards.sh --status
```

## Environment Configuration

### Production `.env`

```bash
# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@managed-db:5432/stella

# LiveKit (external service)
LIVEKIT_URL=wss://livekit.yourdomain.com
PUBLIC_LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=your-production-key
LIVEKIT_API_SECRET=your-production-secret

# CORS
CORS_ORIGIN=https://yourdomain.com

# Public URLs
PUBLIC_SERVER_URL=https://api.yourdomain.com

# Agent Configuration
AGENT_IMAGE=your-registry.com/stella-agent:v1.0.0
KUBERNETES_NAMESPACE=ai-agents
```

### Frontend Production Build

```bash
cd frontend-ui

# Create production environment
cat > .env.production << EOF
VITE_API_URL=https://api.yourdomain.com
VITE_LIVEKIT_URL=wss://livekit.yourdomain.com
EOF

# Build for production
npm run build
```

## Using PM2

For non-Kubernetes deployments, use PM2:

### Install PM2

```bash
npm install -g pm2
```

### Start Services

```bash
# Backend
cd session-management-server
pm2 start npm --name "stella-backend" -- run start:prod

# Frontend (serve built files)
npm install -g serve
pm2 start "serve -s dist -l 8080" --name "stella-frontend"
```

### PM2 Management

```bash
# View status
pm2 status

# View logs
pm2 logs stella-backend

# Restart
pm2 restart stella-backend

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

## Using Systemd

Alternative to PM2 for Linux servers:

### Create Service File

```ini
# /etc/systemd/system/stella-backend.service
[Unit]
Description=STELLA Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/stella/session-management-server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable stella-backend
sudo systemctl start stella-backend
sudo systemctl status stella-backend
```

## Health Checks

### Backend Health Endpoint

```bash
curl https://api.yourdomain.com/health
```

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Backup Strategy

### Database Backups

Set up automated PostgreSQL backups:

```bash
# Daily backup script
pg_dump -h localhost -U stella stella_db > backup_$(date +%Y%m%d).sql

# Upload to cloud storage
aws s3 cp backup_$(date +%Y%m%d).sql s3://your-backups/stella/
```

### Configuration Backups

Version control all configuration:
- Kubernetes manifests
- Nginx configuration
- Environment templates (not secrets)

## Rolling Updates

Deploy new versions without downtime:

```bash
# Update image
kubectl set image deployment/session-management-server \
  session-management-server=your-registry/stella-backend:v2.0.0 \
  -n ai-agents

# Monitor rollout
kubectl rollout status deployment/session-management-server -n ai-agents

# Rollback if needed
kubectl rollout undo deployment/session-management-server -n ai-agents
```

## Security Hardening

### Network Policies

Restrict pod communication:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-policy
  namespace: ai-agents
spec:
  podSelector:
    matchLabels:
      app: session-management-server
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: 3000
```

### Pod Security

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
```

## See Also

- [Nginx Setup](/docs/deployment/nginx-setup)
- [Reverse Proxy](/docs/deployment/reverse-proxy)
- [LiveKit Production](/docs/integration/livekit-production)
