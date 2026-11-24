#!/usr/bin/env bash
set -e

echo "==> Installing dependencies..."
pnpm install

echo "==> Starting DynamoDB Local..."
docker compose up -d dynamodb-local
sleep 3

echo "==> Creating tables..."
node bin/setup-local-dynamodb.js

echo "==> Starting dev server..."
npm run dev
