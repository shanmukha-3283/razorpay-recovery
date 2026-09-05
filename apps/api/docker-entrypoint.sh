#!/bin/sh
# Runs pending DB migrations, then starts the API. Safe to run on every
# boot: drizzle's migrate() is a no-op when nothing is pending. Exits
# non-zero on migration failure so a bad schema never serves traffic.
set -e
node ./apps/api/dist/db/runMigrations.js
exec node ./apps/api/dist/index.js
