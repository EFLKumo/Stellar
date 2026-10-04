#!/bin/sh
set -eu

node --import tsx src/server/setup.ts
exec "$@"
