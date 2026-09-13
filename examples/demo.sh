#!/usr/bin/env bash
# A 30-second DocGov demo on a deliberately messy repository.
#
#   ./examples/demo.sh              # build the repo, run the flow, leave it for poking at
#   ./examples/demo.sh --keep       # same, and print where it lives
#
# Everything here is a real run. Nothing is pre-baked or replayed.
set -euo pipefail

DOCGOV="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin/docgov"
DEMO="$(mktemp -d)"
step() { printf '\n\033[1;32m$ %s\033[0m\n' "$*"; }

cd "$DEMO"
git init -q
git config user.email demo@example.com
git config user.name  Demo

# ── a repository that has been shipped for six months and never tidied ──────────
mkdir -p docs notes src/billing

cat > README.md <<'EOF'
# Shipfast

Does the thing. Built it in a weekend.

## Install
npm i

## Usage
npm start

## Architecture
The billing service talks to Stripe. There is a webhook handler that verifies
signatures and writes to the ledger. The ledger is append-only. We retry failed
charges three times with backoff, then mark the invoice as failed and email the
customer. Invoices are immutable once issued.
EOF

# two documents covering the same topic, disagreeing about the contract
cat > docs/api.md <<'EOF'
# API notes

The billing API is versioned under `/v1`. Authentication uses a bearer token in the
Authorization header. Tokens are issued per workspace and do not expire.

## Invoices

`GET /invoices` returns an array of invoice objects. Each invoice has an `id`, an
`amount_cents` integer, a `currency` string, a `status` and a `created_at` timestamp.
Status is one of `draft`, `open`, `paid` or `failed`.

`POST /invoices` creates a draft invoice. It accepts `amount_cents`, `currency` and
`customer_id`. It returns the created invoice.

## Charges

`POST /invoices/:id/charge` attempts payment. Charges retry three times with backoff
before the invoice is marked failed. Once an invoice is paid it is immutable.

## Errors

Errors return a JSON body with `error` and `message`. Rate limiting returns 429.
EOF

cat > docs/API-old.md <<'EOF'
# api

The billing API is versioned under `/v1`. Authentication uses a bearer token in the
Authorization header. Tokens are issued per workspace and expire after 90 days.

## Invoices

`GET /invoices` returns a paginated object with `items` and `cursor`. Each invoice has an
`id`, an `amount_cents` integer, a `currency` string, a `status` and a `created_at`
timestamp. Status is one of `draft`, `open`, `paid` or `failed`.

`POST /invoices` creates a draft invoice. It accepts `amount_cents`, `currency` and
`customer_id`. It returns the created invoice.

## Charges

`POST /invoices/:id/charge` attempts payment. Charges retry five times with backoff
before the invoice is marked failed. Once an invoice is paid it is immutable.

## Errors

Errors return a JSON body with `error` and `message`. Rate limiting returns 429.
EOF

# a doc in the wrong place, with no metadata
cat > notes/architecture.md <<'EOF'
# How billing works
Stripe webhooks land in src/billing/webhook.js and are verified before the
ledger is written. The ledger is append-only.
EOF

# something that claims to describe code
cat > docs/billing.md <<'EOF'
# Billing
Charges retry three times before the invoice is marked failed.
EOF

cat > src/billing/webhook.js <<'EOF'
export function handle(evt) { return verify(evt); }
EOF
cat > package.json <<'EOF'
{ "name": "shipfast", "version": "1.0.0" }
EOF

git add -A
git commit -qm "six months of shipping"

step "docgov setup"
"$DOCGOV" setup --mode solo

step "docgov review          # reads everything, writes a plan, changes nothing"
"$DOCGOV" review

step "docgov health"
"$DOCGOV" health

step "docgov fix --dry-run   # exactly what it would do"
"$DOCGOV" fix --dry-run

printf '\n\033[1;32mDemo repository:\033[0m %s\n' "$DEMO"
printf 'Nothing was moved — `%s fix` would do that, on a branch, revertible.\n' "docgov"
