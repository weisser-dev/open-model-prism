# Open Model Prism — Development Commands

# Default: show available commands
default:
    @just --list

# One command to rule them all: pull latest, install deps, start MongoDB, backend & frontend
# Hot reloading is built-in: nodemon restarts backend on file changes, Vite HMR updates frontend instantly.
dev: pull install
    #!/usr/bin/env bash
    set -e
    echo "Starting Open Model Prism (dev mode)..."

    # Start MongoDB if not running
    if ! docker compose ps mongodb 2>/dev/null | grep -q "running"; then
        echo "-> Starting MongoDB..."
        docker compose up -d mongodb
    fi
    echo "-> Waiting for MongoDB to be healthy..."
    until docker compose exec mongodb mongosh --quiet --eval 'db.runCommand("ping").ok' 2>/dev/null | grep -q 1; do
        sleep 1
    done
    echo "-> MongoDB ready."

    # Start backend and frontend in parallel
    echo "-> Starting backend (port 3000) + frontend (port 5173)..."
    echo "   Hot reload: nodemon (backend) + Vite HMR (frontend)"
    cd server && npm run dev &
    BACKEND_PID=$!
    cd frontend && npm run dev &
    FRONTEND_PID=$!

    # Trap to clean up on exit
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT

    echo ""
    echo "Ready!"
    echo "   Frontend:  http://localhost:5173"
    echo "   Backend:   http://localhost:3000"
    echo "   Press Ctrl+C to stop"
    echo ""

    wait

# Pull latest changes from remote
pull:
    # git pull --ff-only || (echo "Could not fast-forward, run 'git pull' manually" && exit 1)

# Install all dependencies
install:
    cd server && npm install
    cd frontend && npm install

# Build Docker image
build:
    docker compose build

# Start everything via Docker Compose (production-like, single pod)
up:
    docker compose up -d

# Stop Docker Compose
down:
    docker compose down

# Rebuild and restart
rebuild:
    docker compose build --no-cache && docker compose up -d

# View logs
logs:
    docker compose logs -f app

# MongoDB shell
mongo:
    docker compose exec mongodb mongosh openmodelprism

# Fresh dev start: pull latest, wipe DB, reinstall, start everything clean
dev-clean:
    #!/usr/bin/env bash
    set -e
    echo "Pulling latest & starting fresh..."

    # Pull latest changes
    # git pull

    # Install deps
    cd server && npm install && cd ..
    cd frontend && npm install && cd ..

    # Stop and remove MongoDB volume
    docker compose down -v 2>/dev/null || true
    docker compose up -d mongodb
    echo "-> Waiting for MongoDB to be healthy..."
    until docker compose exec mongodb mongosh --quiet --eval 'db.runCommand("ping").ok' 2>/dev/null | grep -q 1; do
        sleep 1
    done
    echo "-> MongoDB ready."

    # Start backend and frontend in parallel
    echo "-> Starting backend (port 3000) + frontend (port 5173)..."
    cd server && npm run dev &
    BACKEND_PID=$!
    cd frontend && npm run dev &
    FRONTEND_PID=$!

    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT

    echo ""
    echo "Fresh start! DB is empty — setup wizard will appear."
    echo "   Frontend:  http://localhost:5173"
    echo "   Backend:   http://localhost:3000"
    echo "   Press Ctrl+C to stop"
    echo ""

    wait

# Clean everything (containers, volumes, node_modules)
clean:
    docker compose down -v 2>/dev/null || true
    rm -rf server/node_modules frontend/node_modules frontend/dist server/public

# Tag and push a release (usage: just release 0.1.0)
release version:
    git tag -a "v{{version}}" -m "Release v{{version}}"
    git push origin "v{{version}}"
