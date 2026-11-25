# Credit Ledger — everything runs in Docker / Kubernetes.
# Requirements on your Mac: Docker Desktop (or OrbStack). Kubernetes targets also need kubectl,
# which Docker Desktop and OrbStack include.
#
#   make dev          start Postgres + API + web with live reload
#   make test         run all tests in containers
#   make prod         run the production images locally (http://localhost:8080)
#   make k8s-up       deploy to your local Kubernetes cluster
#   make help         list everything

SHELL := /bin/bash
DEV := docker compose -f compose.dev.yml
NS := credit-ledger
API_IMAGE ?= credit-ledger-api:local
WEB_IMAGE ?= credit-ledger-web:local
KIND_CLUSTER ?= kind

.PHONY: help dev dev-detached logs down reset-db psql test prod prod-down env images \
        k8s-secrets k8s-up k8s-status k8s-open k8s-logs k8s-load k8s-down k8s-delete-data

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---------- Development (Docker Compose) ----------
dev: ## Start Postgres, API (port 4000) and web (port 5173) with live reload
	$(DEV) up

dev-detached: ## Same as dev, in the background
	$(DEV) up -d
	@echo "Web: http://localhost:5173  API: http://localhost:4000  (make logs to follow)"

logs: ## Follow API and web logs
	$(DEV) logs -f api web

down: ## Stop the dev stack (keeps the database)
	$(DEV) down

reset-db: ## Stop the dev stack AND delete the dev database
	$(DEV) down -v

psql: ## Open a psql shell inside the dev database container
	$(DEV) exec db psql -U ledger -d ledger

test: ## Run typecheck + all tests (shared, API with real Postgres, Go agent) in containers
	$(DEV) --profile test run --rm test
	$(DEV) --profile test run --rm agent-test
	$(DEV) --profile test stop db-test

# ---------- Production images locally ----------
env: ## Create .env with random secrets (only if it doesn't exist)
	@if [ -f .env ]; then echo ".env already exists"; else \
	  cp .env.example .env && \
	  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$(openssl rand -hex 16)/; s/^JWT_SECRET=.*/JWT_SECRET=$$(openssl rand -hex 32)/; s/^STATEMENT_LINK_SECRET=.*/STATEMENT_LINK_SECRET=$$(openssl rand -hex 32)/" .env && \
	  rm -f .env.bak && echo "Created .env with random secrets"; fi

prod: env ## Build and run the production images (http://localhost:8080)
	docker compose up --build

prod-down: ## Stop the production-like stack
	docker compose down

images: ## Build the API and web images for Kubernetes
	docker build -f apps/api/Dockerfile -t $(API_IMAGE) .
	docker build -f apps/web/Dockerfile -t $(WEB_IMAGE) .

# ---------- Kubernetes (Docker Desktop / OrbStack / kind) ----------
k8s-secrets: ## Create the app secrets in the cluster (once; never overwrites)
	@kubectl get namespace $(NS) >/dev/null 2>&1 || kubectl create namespace $(NS)
	@if kubectl -n $(NS) get secret credit-ledger-secrets >/dev/null 2>&1; then echo "secret already exists"; else \
	  kubectl -n $(NS) create secret generic credit-ledger-secrets \
	    --from-literal=POSTGRES_PASSWORD=$$(openssl rand -hex 16) \
	    --from-literal=JWT_SECRET=$$(openssl rand -hex 32) \
	    --from-literal=STATEMENT_LINK_SECRET=$$(openssl rand -hex 32) \
	    --from-literal=WHATSAPP_TOKEN= \
	    --from-literal=WHATSAPP_APP_SECRET= \
	    --from-literal=WHATSAPP_VERIFY_TOKEN= && echo "created secret credit-ledger-secrets"; fi

k8s-up: images k8s-secrets ## Build images and deploy everything to the current kube context
	kubectl apply -k deploy/k8s
	kubectl -n $(NS) rollout status statefulset/postgres --timeout=180s
	kubectl -n $(NS) rollout restart deployment/api deployment/web
	kubectl -n $(NS) rollout status deployment/api --timeout=180s
	kubectl -n $(NS) rollout status deployment/web --timeout=120s
	@echo "Deployed. Run 'make k8s-open' and visit http://localhost:8080"

k8s-load: images ## kind only: copy the local images into the kind cluster
	kind load docker-image $(API_IMAGE) $(WEB_IMAGE) --name $(KIND_CLUSTER)

k8s-status: ## Show pods, services and recent events
	kubectl -n $(NS) get pods,svc,pvc
	kubectl -n $(NS) get events --sort-by=.lastTimestamp | tail -15

k8s-open: ## Forward http://localhost:8080 to the web service (Ctrl+C to stop)
	kubectl -n $(NS) port-forward svc/web 8080:80

k8s-logs: ## Follow API logs
	kubectl -n $(NS) logs -f deployment/api

k8s-down: ## Remove the app but keep the database volume and secrets
	kubectl delete -k deploy/k8s --ignore-not-found
	@echo "Database volume kept. 'make k8s-delete-data' removes it."

k8s-delete-data: ## Delete EVERYTHING in the namespace, including the database
	kubectl delete namespace $(NS) --ignore-not-found
