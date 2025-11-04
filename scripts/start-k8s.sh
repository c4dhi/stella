#!/bin/bash
set -e

# Parse command line flags
DAEMON_MODE=false
STOP_MODE=false
PID_DIR="/tmp/grace-ai-k8s"

for arg in "$@"; do
    case $arg in
        --daemon|-d)
            DAEMON_MODE=true
            shift
            ;;
        --stop)
            STOP_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --daemon, -d    Run in background (survives SSH logout)"
            echo "  --stop          Stop background services"
            echo "  --help, -h      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0              # Run in foreground (Ctrl+C to stop)"
            echo "  $0 --daemon     # Run in background"
            echo "  $0 --stop       # Stop background services"
            exit 0
            ;;
    esac
done

# Handle stop mode
if [ "$STOP_MODE" = true ]; then
    echo "🛑 Stopping Grace AI Kubernetes services..."

    # Stop port-forwards
    if [ -f "$PID_DIR/port-forwards.pid" ]; then
        while read pid; do
            kill $pid 2>/dev/null && echo "  ✓ Stopped port-forward (PID: $pid)" || true
        done < "$PID_DIR/port-forwards.pid"
        rm "$PID_DIR/port-forwards.pid"
    fi

    # Stop minikube
    echo "  • Stopping minikube cluster..."
    minikube stop

    echo ""
    echo "✅ All services stopped"
    exit 0
fi

# Force English language for all commands
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Create PID directory
mkdir -p "$PID_DIR"

# Setup logging for daemon mode
if [ "$DAEMON_MODE" = true ]; then
    LOG_FILE="$PID_DIR/grace-ai-k8s.log"
    exec 1> >(tee -a "$LOG_FILE")
    exec 2>&1
    echo "=== Grace AI K8s Deployment - $(date) ==="
fi

# Detect operating system
OS_TYPE=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS_TYPE="linux"
else
    echo "Warning: Unknown OS type: $OSTYPE. Assuming Linux."
    OS_TYPE="linux"
fi

# Ensure Docker and other tools are in PATH
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: Include Homebrew and OrbStack paths
    export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$PATH"
else
    # Linux: Use standard paths
    export PATH="/usr/local/bin:/usr/bin:/usr/sbin:$PATH"
fi

# Set Docker socket path based on OS
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: OrbStack socket
    export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.orbstack/run/docker.sock}"
else
    # Linux: Standard Docker socket
    export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Grace AI - Kubernetes Deployment${NC}"

# Change to script directory
cd "$(dirname "$0")/.."

# Load environment variables from .env file
if [ -f .env ]; then
    set -a  # automatically export all variables
    source .env
    set +a
else
    echo -e "${RED}✗ Error: .env file not found${NC}"
    echo "  Run: cp .env.example .env && nano .env"
    exit 1
fi

# Validate required environment variables
if [ -z "$OPENAI_API_KEY" ] || [ -z "$POSTGRES_DB" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
    echo -e "${RED}✗ Missing required environment variables in .env${NC}"
    [ -z "$OPENAI_API_KEY" ] && echo "  - OPENAI_API_KEY"
    [ -z "$POSTGRES_DB" ] && echo "  - POSTGRES_DB"
    [ -z "$POSTGRES_USER" ] && echo "  - POSTGRES_USER"
    [ -z "$POSTGRES_PASSWORD" ] && echo "  - POSTGRES_PASSWORD"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running${NC}"
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "${YELLOW}💡 On Linux, you may need to:${NC}"
        echo -e "   1. Start Docker: sudo systemctl start docker"
        echo -e "   2. Add your user to docker group: sudo usermod -aG docker \$USER"
        echo -e "   3. Log out and back in for group changes to take effect"
    fi
    exit 1
fi

# Check Docker permissions on Linux
if [[ "$OS_TYPE" == "linux" ]]; then
    if ! groups | grep -q docker; then
        echo -e "${YELLOW}⚠️  Warning: Your user is not in the 'docker' group${NC}"
        echo -e "${YELLOW}   You may encounter permission issues.${NC}"
        echo -e "${YELLOW}   To fix: sudo usermod -aG docker \$USER && newgrp docker${NC}"
        echo ""
    fi
fi

# Check if required ports are available
REQUIRED_PORTS=(3000 5173 7880 5432)
PORTS_IN_USE=()

for port in "${REQUIRED_PORTS[@]}"; do
    PORT_IN_USE=false
    PROCESS_INFO=""

    if [[ "$OS_TYPE" == "macos" ]]; then
        # macOS: Use lsof
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            PORT_IN_USE=true
            PROCESS_INFO=$(lsof -Pi :$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1 " (PID: " $2 ")"}')
        fi
    else
        # Linux: Try ss first, fallback to lsof if available
        if command -v ss &> /dev/null; then
            if ss -tlnp 2>/dev/null | grep -q ":$port "; then
                PORT_IN_USE=true
                PROCESS_INFO=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
                if [ -n "$PROCESS_INFO" ]; then
                    PROCESS_NAME=$(ps -p $PROCESS_INFO -o comm= 2>/dev/null || echo "unknown")
                    PROCESS_INFO="$PROCESS_NAME (PID: $PROCESS_INFO)"
                fi
            fi
        elif command -v lsof &> /dev/null; then
            if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                PORT_IN_USE=true
                PROCESS_INFO=$(lsof -Pi :$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1 " (PID: " $2 ")"}')
            fi
        fi
    fi

    if [ "$PORT_IN_USE" = true ]; then
        PORTS_IN_USE+=($port)
        echo -e "${RED}✗ Port $port in use: $PROCESS_INFO${NC}"
    fi
done

if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
    echo -e "${RED}Stop services and try again (kill -9 <PID>)${NC}"
    exit 1
fi

# Check if required tools are installed
if ! command -v minikube &> /dev/null; then
    echo -e "${YELLOW}Installing minikube...${NC}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        brew install minikube
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # Download and install minikube for Linux
        MINIKUBE_VERSION=$(curl -s https://api.github.com/repos/kubernetes/minikube/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
        curl -LO "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64"
        sudo install minikube-linux-amd64 /usr/local/bin/minikube
        rm minikube-linux-amd64
        echo -e "${GREEN}✓ Minikube installed${NC}"
    else
        echo -e "${RED}✗ Unable to auto-install minikube on this platform${NC}"
        echo -e "${YELLOW}Visit: https://minikube.sigs.k8s.io/docs/start/${NC}"
        exit 1
    fi
fi

if ! command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}Installing kubectl...${NC}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        brew install kubectl
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # Download and install kubectl for Linux
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        chmod +x kubectl
        sudo mv kubectl /usr/local/bin/kubectl
        echo -e "${GREEN}✓ kubectl installed${NC}"
    else
        echo -e "${RED}✗ Unable to auto-install kubectl on this platform${NC}"
        echo -e "${YELLOW}Visit: https://kubernetes.io/docs/tasks/tools/${NC}"
        exit 1
    fi
fi

# Start minikube if not running
echo -e "${GREEN}⚙️  Starting minikube...${NC}"
minikube status | grep -q "Running" || minikube start --driver=docker --cpus=4 --memory=8192

# Configure environment
minikube addons enable metrics-server 2>/dev/null
minikube addons enable dashboard 2>/dev/null
kubectl config use-context minikube > /dev/null 2>&1
eval $(minikube docker-env)

# Detect if BuildKit/buildx is available
USE_BUILDKIT=false
if docker buildx version > /dev/null 2>&1; then
    USE_BUILDKIT=true
    echo -e "${GREEN}✓ BuildKit available, using optimized builds${NC}"
else
    echo -e "${YELLOW}⚠️  BuildKit not available${NC}"

    # Auto-install on Linux
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "${YELLOW}Installing docker-buildx...${NC}"

        # Temporarily disable exit on error
        set +e

        # Method 1: Try package installation first
        INSTALL_RESULT=$(sudo apt-get install -y docker-buildx-plugin 2>&1)
        INSTALL_EXIT_CODE=$?

        # Check if package install worked
        if [ $INSTALL_EXIT_CODE -eq 0 ] && docker buildx version > /dev/null 2>&1; then
            USE_BUILDKIT=true
            echo -e "${GREEN}✓ BuildKit installed via apt package${NC}"
        # Method 2: Package not found, try manual installation
        elif echo "$INSTALL_RESULT" | grep -q "Unable to locate package"; then
            echo -e "${YELLOW}   Package not available, trying manual installation...${NC}"

            # Create docker CLI plugins directory
            mkdir -p ~/.docker/cli-plugins

            # Download buildx binary
            BUILDX_VERSION=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
            curl -sL "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx
            chmod +x ~/.docker/cli-plugins/docker-buildx

            # Verify installation
            if docker buildx version > /dev/null 2>&1; then
                USE_BUILDKIT=true
                echo -e "${GREEN}✓ BuildKit installed manually (v${BUILDX_VERSION})${NC}"
            else
                echo -e "${YELLOW}⚠️  Manual installation failed, using legacy build mode${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  BuildKit installation failed (exit code: $INSTALL_EXIT_CODE)${NC}"
            echo -e "${YELLOW}   Using legacy build mode${NC}"
        fi

        # Re-enable exit on error
        set -e
    else
        echo -e "${YELLOW}⚠️  Using legacy build mode (install docker-buildx for better performance)${NC}"
    fi
fi

# Build Docker images
echo -e "${GREEN}🔨 Building Docker images...${NC}"

echo -n "  • session-management-server... "
if [ "$USE_BUILDKIT" = true ]; then
    DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t session-management-server:latest . > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
else
    docker build -q --network=host -t session-management-server:latest . > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

echo -n "  • conversational-ai-server... "
if [ "$USE_BUILDKIT" = true ]; then
    DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t conversational-ai-server:latest ./conversational-ai-server-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
else
    docker build -q --network=host -t conversational-ai-server:latest ./conversational-ai-server-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

echo -n "  • frontend-ui... "
if [ "$USE_BUILDKIT" = true ]; then
    DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t frontend-ui:latest ./frontend-ui > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
else
    docker build -q --network=host -t frontend-ui:latest ./frontend-ui > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

echo -n "  • message-recorder... "
if [ "$USE_BUILDKIT" = true ]; then
    DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t message-recorder-python:latest ./message-recorder-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
else
    docker build -q --network=host -t message-recorder-python:latest ./message-recorder-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

# Detect network IP for public URLs
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: Use ifconfig
    NETWORK_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
else
    # Linux: Use hostname -I (simpler and more reliable)
    NETWORK_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

    # Fallback to ip command if hostname -I fails
    if [ -z "$NETWORK_IP" ]; then
        NETWORK_IP=$(ip addr show | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | cut -d'/' -f1 | head -1)
    fi
fi

echo -e "${GREEN}📡 Detected network IP: ${NETWORK_IP}${NC}"

# Inject network IP into ConfigMap
echo -n "  • Updating ConfigMap with network IP... "
sed "s/NETWORK_IP_PLACEHOLDER/${NETWORK_IP}/g" k8s/04-configmap.yaml > /tmp/04-configmap-updated.yaml
echo -e "${GREEN}✓${NC}"

# Deploy to Kubernetes
echo -e "${GREEN}☸️  Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/00-namespace.yaml > /dev/null
kubectl apply -f k8s/01-postgres.yaml > /dev/null
kubectl apply -f k8s/02-livekit.yaml > /dev/null
kubectl apply -f k8s/03-secrets.yaml > /dev/null
kubectl apply -f /tmp/04-configmap-updated.yaml > /dev/null
kubectl apply -f k8s/05-rbac.yaml > /dev/null
kubectl apply -f k8s/06-message-recorder.yaml > /dev/null
kubectl apply -f k8s/06-session-management-server.yaml > /dev/null
kubectl apply -f k8s/07-frontend-ui.yaml > /dev/null

# Create secrets
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
kubectl create secret generic grace-ai-secrets -n ai-agents \
  --from-literal=postgres-db="$POSTGRES_DB" \
  --from-literal=postgres-user="$POSTGRES_USER" \
  --from-literal=postgres-password="$POSTGRES_PASSWORD" \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=jwt-secret="dev-secret-change-in-production" \
  --from-literal=livekit-api-key="devkey" \
  --from-literal=livekit-api-secret="secret" \
  --from-literal=livekit-webhook-secret="webhook-secret" \
  --from-literal=elevenlabs-api-key="" \
  --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Wait for services
echo -n "  • Waiting for PostgreSQL... "
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • Waiting for LiveKit... "
kubectl wait --for=condition=ready pod -l app=livekit -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

# Restart deployments
kubectl rollout restart deployment session-management-server -n ai-agents > /dev/null 2>&1
kubectl rollout restart deployment frontend-ui -n ai-agents > /dev/null 2>&1

echo -n "  • Waiting for backend... "
kubectl rollout status deployment/session-management-server -n ai-agents --timeout=180s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • Waiting for frontend... "
kubectl rollout status deployment/frontend-ui -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"


# Start port-forwards to expose services on localhost and network
echo -e "${GREEN}🌐 Setting up port forwards...${NC}"

if [ "$DAEMON_MODE" = true ]; then
    # Daemon mode: Use nohup and save PIDs
    # Using non-standard ports to avoid conflicts with nginx
    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > "$PID_DIR/pf-frontend.log" 2>&1 &
    PF_FRONTEND=$!

    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3001:3000 > "$PID_DIR/pf-backend.log" 2>&1 &
    PF_BACKEND=$!

    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/livekit 7881:7880 > "$PID_DIR/pf-livekit.log" 2>&1 &
    PF_LIVEKIT=$!

    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5433:5432 > "$PID_DIR/pf-postgres.log" 2>&1 &
    PF_POSTGRES=$!

    # Save PIDs to file
    echo "$PF_FRONTEND" > "$PID_DIR/port-forwards.pid"
    echo "$PF_BACKEND" >> "$PID_DIR/port-forwards.pid"
    echo "$PF_LIVEKIT" >> "$PID_DIR/port-forwards.pid"
    echo "$PF_POSTGRES" >> "$PID_DIR/port-forwards.pid"

    # Detach from session
    disown -a
else
    # Foreground mode: Normal background processes
    # Using non-standard ports to avoid conflicts with nginx
    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > /dev/null 2>&1 &
    PF_FRONTEND=$!

    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3001:3000 > /dev/null 2>&1 &
    PF_BACKEND=$!

    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/livekit 7881:7880 > /dev/null 2>&1 &
    PF_LIVEKIT=$!

    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5433:5432 > /dev/null 2>&1 &
    PF_POSTGRES=$!
fi

echo -e "${GREEN}✓ Port forwards started${NC}"

# Give port forwards a moment to initialize
sleep 2

# Cleanup function to stop all services (only for foreground mode)
if [ "$DAEMON_MODE" = false ]; then
  cleanup() {
    echo ""
    echo ""
    echo -e "${YELLOW}🛑 Stopping all services...${NC}"
    echo ""

    # Kill port-forward processes
    echo -e "${BLUE}Stopping port forwards...${NC}"
    [ ! -z "$PF_FRONTEND" ] && kill $PF_FRONTEND 2>/dev/null
    [ ! -z "$PF_BACKEND" ] && kill $PF_BACKEND 2>/dev/null
    [ ! -z "$PF_LIVEKIT" ] && kill $PF_LIVEKIT 2>/dev/null
    [ ! -z "$PF_POSTGRES" ] && kill $PF_POSTGRES 2>/dev/null

    # Stop minikube (stops all services gracefully)
    echo -e "${BLUE}Stopping minikube cluster...${NC}"
    minikube stop

    echo ""
    echo -e "${GREEN}✅ All services stopped${NC}"
    echo -e "${BLUE}To restart, run: ./scripts/start-k8s.sh${NC}"
    echo ""
    exit 0
  }

  # Trap SIGINT (Ctrl+C) and SIGTERM in foreground mode only
  trap cleanup SIGINT SIGTERM
fi

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo -e "${BLUE}🌐 Services accessible at:${NC}"
echo ""
echo -e "${GREEN}Direct Access (via kubectl port-forward):${NC}"
echo -e "  ${GREEN}Frontend:${NC}  http://localhost:8080"
echo -e "  ${GREEN}Backend:${NC}   http://localhost:3001"
echo -e "  ${GREEN}LiveKit:${NC}   ws://localhost:7881"
echo -e "  ${GREEN}Database:${NC}  localhost:5433"
echo ""
echo -e "${YELLOW}⚠️  Configure nginx to proxy standard ports → localhost${NC}"
echo -e "${YELLOW}   Port 80 → 8080 (Frontend)${NC}"
echo -e "${YELLOW}   Port 3000 → 3001 (Backend)${NC}"
echo -e "${YELLOW}   Port 7880 → 7881 (LiveKit)${NC}"
echo -e "${YELLOW}   Port 5432 → 5433 (Database)${NC}"
echo ""
echo -e "${GREEN}After nginx setup, services will be available at:${NC}"
echo -e "  ${GREEN}Frontend:${NC}  http://${NETWORK_IP}"
echo -e "  ${GREEN}Backend:${NC}   http://${NETWORK_IP}:3000"
echo -e "  ${GREEN}LiveKit:${NC}   ws://${NETWORK_IP}:7880"
echo -e "  ${GREEN}Database:${NC}  ${NETWORK_IP}:5432"
echo ""

if [ "$DAEMON_MODE" = true ]; then
    # Daemon mode: Show status and exit
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✨ Services running in background${NC}"
    echo -e "${YELLOW}📝 Logs: $LOG_FILE${NC}"
    echo -e "${YELLOW}🛑 Stop: ./scripts/start-k8s.sh --stop${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Port-forward PIDs saved to: $PID_DIR/port-forwards.pid"
    echo "Services will continue running after SSH logout."
    echo ""
else
    # Foreground mode: Keep script running
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✨ Services are running${NC}"
    echo -e "${RED}⚠️  Press Ctrl+C to stop all services and shutdown minikube${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Keep script running
    tail -f /dev/null
fi
