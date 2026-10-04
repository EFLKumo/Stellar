#!/usr/bin/env bash
set -euo pipefail
umask 077

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$project_dir"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

for tool in podman python3 curl; do
  command -v "$tool" >/dev/null || fail "Install $tool. See docs/deployment.md."
done

if [[ ! -f .env ]]; then
  cp .env.example .env
  printf 'Created .env. Set the AI provider keys in this file.\n'
fi
chmod 600 .env

python3 -c 'from dotenv import dotenv_values, set_key' >/dev/null 2>&1 || fail 'Install python-dotenv. See docs/deployment.md.'
configuration_file=$(mktemp)
trap 'rm -f -- "$configuration_file"' EXIT
python3 - "$project_dir/.env" > "$configuration_file" <<'PYTHON'
import json
import re
import secrets
import sys
from urllib.parse import urlsplit
from dotenv import dotenv_values, set_key

path = sys.argv[1]
settings = dotenv_values(path)

def fail(message):
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)

def required(name):
    value = settings.get(name)
    if not value:
        fail(f"Set {name} in .env.")
    return value

for name in ("POSTGRES_PASSWORD", "BETTER_AUTH_SECRET", "STELLAR_ADMIN_PASSWORD"):
    if not settings.get(name):
        settings[name] = secrets.token_hex(32)
        set_key(path, name, settings[name], quote_mode="never")
        print(f"Generated {name}. Read the value in .env.", file=sys.stderr)

if not re.fullmatch(r"[a-zA-Z0-9._~-]+", required("POSTGRES_PASSWORD")):
    fail("Use URL-safe characters in POSTGRES_PASSWORD.")
if len(required("BETTER_AUTH_SECRET")) < 32:
    fail("Set BETTER_AUTH_SECRET to at least 32 characters.")
if len(required("STELLAR_ADMIN_PASSWORD")) < 12:
    fail("Set STELLAR_ADMIN_PASSWORD to at least 12 characters.")
required("STELLAR_ADMIN_EMAIL")
if not re.fullmatch(r"[a-z0-9_]{3,32}", required("STELLAR_ADMIN_USERNAME")):
    fail("Use 3 to 32 lower-case letters, numbers, or underscores in STELLAR_ADMIN_USERNAME.")

try:
    models = json.loads(required("AI_MODELS"))
except json.JSONDecodeError:
    fail("Set AI_MODELS to a valid JSON array.")
if not isinstance(models, list) or not models:
    fail("Set AI_MODELS to a non-empty JSON array.")
keys = {"google": "GOOGLE_GENERATIVE_AI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
identifiers = set()
for model in models:
    if not isinstance(model, dict) or any(not isinstance(model.get(field), str) or not model[field] for field in ("id", "name", "provider", "model")):
        fail("Each AI_MODELS item must contain id, name, provider, and model strings.")
    if model["id"] in identifiers:
        fail("Use unique IDs in AI_MODELS.")
    identifiers.add(model["id"])
    if model["provider"] not in keys:
        fail("Use google, openai, or anthropic providers in AI_MODELS.")
    required(keys[model["provider"]])

ports = []
for name, default in (("HTTP_PORT", 8080), ("HTTPS_PORT", 8443)):
    try:
        port = int(settings.get(name) or default)
    except ValueError:
        fail(f"Set {name} to a port number from 1 to 65535.")
    if not 1 <= port <= 65535:
        fail(f"Set {name} to a port number from 1 to 65535.")
    ports.append(port)

domain = required("DOMAIN")
origin = required("APP_ORIGIN")
if not re.fullmatch(r"[a-zA-Z0-9.-]+", domain):
    fail("Set DOMAIN to a host name without a scheme, port, or path.")
local = domain.lower() in ("localhost", "127.0.0.1")
try:
    address = urlsplit(origin)
    valid = address.scheme == ("http" if local else "https") and address.hostname == domain.lower() and not (address.username or address.password or address.path or address.query or address.fragment) and " " not in origin
    origin_port = address.port
except ValueError:
    valid = False
if not valid:
    fail("Set APP_ORIGIN to the complete HTTP local address or HTTPS public address for DOMAIN.")
if local and (origin_port or 80) != ports[0]:
    fail("Set the APP_ORIGIN port to the HTTP_PORT value for a local deployment.")

# The shell receives only public configuration values.
for value in (domain, origin, *ports):
    sys.stdout.buffer.write(str(value).encode() + b"\0")
PYTHON
{
  IFS= read -r -d '' domain
  IFS= read -r -d '' origin
  IFS= read -r -d '' http_port
  IFS= read -r -d '' https_port
} < "$configuration_file"
rm -f -- "$configuration_file"
trap - EXIT

if [[ -z ${PODMAN_COMPOSE_PROVIDER:-} ]] && command -v podman-compose >/dev/null; then
  export PODMAN_COMPOSE_PROVIDER
  PODMAN_COMPOSE_PROVIDER=$(command -v podman-compose)
fi
export PODMAN_COMPOSE_WARNING_LOGS=false
podman compose version >/dev/null || fail 'Install a Podman Compose provider. See docs/deployment.md.'
rootless=$(podman info --format '{{.Host.Security.Rootless}}') || fail 'Start Podman. See docs/deployment.md.'
if [[ $rootless == true && -r /proc/sys/net/ipv4/ip_unprivileged_port_start ]]; then
  minimum_port=$(< /proc/sys/net/ipv4/ip_unprivileged_port_start)
  if (( http_port < minimum_port || https_port < minimum_port )); then
    fail "Rootless Podman cannot bind the configured ports. Use ports of $minimum_port or higher, or complete the domain procedure in docs/deployment.md."
  fi
fi

compose() {
  podman compose --env-file "$project_dir/.env" -f "$project_dir/compose.yaml" "$@"
}

compose config >/dev/null
printf 'Build the application image.\n'
compose build app
printf 'Start the database.\n'
compose up -d database
database_ready=false
for (( attempt=0; attempt<60; attempt++ )); do
  if compose exec -T database pg_isready -U stellar -d stellar >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 2
done
[[ $database_ready == true ]] || fail 'The database did not become ready. Read the database logs with podman compose logs database.'

printf 'Start the application.\n'
compose up -d --no-build app
application_ready=false
for (( attempt=0; attempt<90; attempt++ )); do
  if compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(4000) }).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))" >/dev/null 2>&1; then
    application_ready=true
    break
  fi
  sleep 2
done
[[ $application_ready == true ]] || fail 'The application did not become ready. Read the application logs with podman compose logs app.'

printf 'Start the RSS worker and the proxy.\n'
compose up -d --no-build worker proxy
proxy_ready=false
for (( attempt=0; attempt<60; attempt++ )); do
  if curl --fail --silent --show-error --max-time 5 "$origin/api/health" >/dev/null 2>&1; then
    proxy_ready=true
    break
  fi
  sleep 2
done
[[ $proxy_ready == true ]] || fail 'The site did not become ready. Check DNS, the host ports, and the proxy logs. See docs/deployment.md.'

compose exec -T worker sh -c 'kill -0 1' >/dev/null 2>&1 || fail 'The RSS worker stopped. Read the worker logs with podman compose logs worker.'

printf 'Stellar is ready at %s.\n' "$origin"
printf 'Sign in with STELLAR_ADMIN_USERNAME and STELLAR_ADMIN_PASSWORD from .env.\n'
