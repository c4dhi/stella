# Production Deployment Checklist

Quick guide for deploying to your production server at `c4dhi.moserfelix.com`

## 📋 Required Changes in .env.production

Before deploying, you **MUST** change these values in `.env.production`:

### 🔐 Security Credentials (CRITICAL - Must Change!)

```bash
# 1. Database Password
POSTGRES_PASSWORD=CHANGE_THIS_PRODUCTION_PASSWORD
DATABASE_URL="postgresql://postgres:YOUR_NEW_PASSWORD@localhost:5432/session_management?schema=public"

# 2. JWT Secret (use a long random string)
JWT_SECRET=CHANGE_THIS_TO_A_SECURE_RANDOM_STRING_IN_PRODUCTION

# 3. LiveKit Credentials
LIVEKIT_API_KEY=prod-api-key-change-this
LIVEKIT_API_SECRET=prod-api-secret-change-this
LIVEKIT_WEBHOOK_SECRET=prod-webhook-secret-change-this

# 4. OpenAI API Key (your production key)
OPENAI_API_KEY=sk-proj-YOUR_PRODUCTION_OPENAI_KEY_HERE
```

### 🔧 Generate Secure Values

Use these commands to generate secure random values:

```bash
# Generate database password (32 characters)
openssl rand -base64 32

# Generate JWT secret (64 characters)
openssl rand -base64 64

# Generate LiveKit credentials (32 characters each)
openssl rand -base64 32  # API Key
openssl rand -base64 32  # API Secret
openssl rand -base64 32  # Webhook Secret
```

### ✅ Already Configured (No Changes Needed)

These are already set correctly for your domain:
- ✅ `NODE_ENV=production`
- ✅ `PRODUCTION_DOMAIN=c4dhi.moserfelix.com`
- ✅ All public URLs (automatically generated from domain)

## 🚀 Deployment Steps

### 1. Copy Files to Production Server

```bash
# On your local machine
scp .env.production your-server:~/grace-ai-backend/.env

# SSH to server
ssh your-server
cd ~/grace-ai-backend
```

### 2. Verify Environment File

```bash
# Check NODE_ENV is set to production
grep "NODE_ENV" .env

# Should show: NODE_ENV=production
```

### 3. Deploy Services

```bash
# Deploy in daemon mode (survives SSH logout)
./scripts/start-k8s.sh --daemon
```

### 4. Set Up Monitoring

Choose one option:

**Option A: Systemd Service (Recommended)**

```bash
# Edit with your actual paths
nano scripts/systemd/grace-ai-port-forwards.service

# Replace:
# - YOUR_USERNAME → your actual username
# - /path/to/grace-ai-backend → /home/youruser/grace-ai-backend

# Install
sudo cp scripts/systemd/grace-ai-port-forwards.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable grace-ai-port-forwards
sudo systemctl start grace-ai-port-forwards

# Check status
sudo systemctl status grace-ai-port-forwards
```

**Option B: Cron Job (Simple)**

```bash
crontab -e

# Add this line (update path):
* * * * * /home/youruser/grace-ai-backend/scripts/monitor-port-forwards.sh --once >> /tmp/grace-ai-k8s/cron.log 2>&1
```

### 5. Verify Deployment

```bash
# Check port-forward status
./scripts/monitor-port-forwards.sh --status

# Should show all green checkmarks:
#   ✓ frontend-ui:8080 (PID: xxxxx)
#   ✓ backend:3000 (PID: xxxxx)
#   ✓ livekit:7880 (PID: xxxxx)
#   ✓ postgres:5432 (PID: xxxxx)

# Test locally
curl http://localhost:8080
curl http://localhost:3000/health

# Test through nginx
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health
```

### 6. Access Your Application

Open in browser:
- **Frontend**: https://frontend.c4dhi.moserfelix.com
- **Backend API**: https://backend.c4dhi.moserfelix.com
- **LiveKit**: wss://livekit.c4dhi.moserfelix.com

## 🔍 Troubleshooting

### Port-forwards not running

```bash
# Check status
./scripts/monitor-port-forwards.sh --status

# Restart if needed
./scripts/monitor-port-forwards.sh --restart

# Or redeploy
./scripts/start-k8s.sh --daemon
```

### 502 Bad Gateway

```bash
# Check Kubernetes pods
kubectl get pods -n ai-agents

# Check logs
kubectl logs -f -n ai-agents deployment/session-management-server
kubectl logs -f -n ai-agents deployment/frontend-ui

# Check port-forwards
./scripts/monitor-port-forwards.sh --status
```

### SSL Certificate Issues

```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Verify certificates
sudo certbot certificates

# Renew if needed
sudo certbot renew
```

## 📊 Monitoring

### Check Service Health

```bash
# Kubernetes pods
kubectl get pods -n ai-agents

# Port-forwards
./scripts/monitor-port-forwards.sh --status

# Systemd service (if using)
sudo systemctl status grace-ai-port-forwards
sudo journalctl -u grace-ai-port-forwards -f

# Application logs
kubectl logs -f -n ai-agents deployment/session-management-server
```

### Monitor Logs

```bash
# Port-forward monitor
tail -f /tmp/grace-ai-k8s/monitor.log

# Deployment logs
tail -f /tmp/grace-ai-k8s/grace-ai-k8s.log

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## 🔄 After Server Restart

If using systemd, services start automatically.

If not:
```bash
cd ~/grace-ai-backend
./scripts/start-k8s.sh --daemon
```

## 📚 Additional Documentation

- **Complete Deployment Guide**: `docs/DEPLOYMENT_GUIDE.md`
- **Nginx Configuration**: `docs/NGINX_SETUP.md`
- **Configuration Summary**: `CONFIGURATION_SUMMARY.md`

## ⚠️ Security Notes

1. **Never commit** `.env.production` to git (it's gitignored)
2. **Use strong passwords** for all production credentials
3. **Rotate API keys** regularly
4. **Back up** your database regularly
5. **Monitor logs** for suspicious activity

## ✅ Production Readiness Checklist

- [ ] Changed all passwords in `.env.production`
- [ ] Changed JWT_SECRET to secure random string
- [ ] Changed LiveKit credentials
- [ ] Added production OpenAI API key
- [ ] Copied `.env.production` to server as `.env`
- [ ] Verified `NODE_ENV=production` in `.env`
- [ ] Deployed with `./scripts/start-k8s.sh --daemon`
- [ ] Set up monitoring (systemd or cron)
- [ ] Tested all URLs through browser
- [ ] Verified SSL certificates are valid
- [ ] Set up database backups
- [ ] Documented production credentials securely

---

**Quick Deploy Command:**
```bash
# On production server, after copying .env.production as .env
./scripts/start-k8s.sh --daemon && ./scripts/monitor-port-forwards.sh --status
```
