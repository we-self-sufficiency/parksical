#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
exec node node_modules/prisma/build/index.js migrate deploy
