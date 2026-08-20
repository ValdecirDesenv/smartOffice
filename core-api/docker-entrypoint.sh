#!/bin/sh
set -e

echo "Running database migrations..."
npx node-pg-migrate up -m src/db/migrations -j js

echo "Starting server..."
exec node dist/server.js
