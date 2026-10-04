# Development

## Prepare the workspace

Use Node.js 26 and pnpm 11.25.0.
Install the workspace packages from the lock file.

```sh
pnpm install --frozen-lockfile
```

Biome checks and formats the TypeScript, JavaScript, JSON, and CSS files.
The Effect development tools check Effect programs during type checks.
See the [Effect development tool instructions](https://effect.website/docs/v4/getting-started/devtools).

## Start the database

1. Copy `.env.example` to `.env`.
2. Set the authentication and administrator secrets.
3. Set the provider keys.
4. Start a separate development database.

```sh
podman run --detach --name stellar-dev-database \
  --publish 127.0.0.1:5432:5432 \
  --env POSTGRES_DB=stellar \
  --env POSTGRES_USER=stellar \
  --env POSTGRES_PASSWORD=stellar-development \
  --volume stellar_dev_database:/var/lib/postgresql \
  docker.io/library/postgres:18-alpine
```

5. Set the connection address and authentication address in `.env`.

```dotenv
DATABASE_URL=postgresql://stellar:stellar-development@127.0.0.1:5432/stellar
BETTER_AUTH_URL=http://localhost:3000
```

The development database publishes port 5432 only on the local host.
It uses a separate volume from the deployment database.

6. Run database setup with the environment file.
7. Start Vite with the same environment file.

```sh
cd apps/web
node --env-file=../../.env --import tsx src/server/setup.ts
node --env-file=../../.env node_modules/vite/bin/vite.js --port 3000
```

Node.js reads `.env` before it starts setup or Vite.
Run the workspace commands below from the workspace root.

## Run workspace commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server with environment variables already set. |
| `pnpm build` | Build the server and browser files. |
| `pnpm typecheck` | Generate routes and check types. |
| `pnpm lint` | Check files with Biome. |
| `pnpm format` | Format files and apply Biome fixes. |

The production server starts from `apps/web/.output/server/index.mjs`.
The container starts database setup before it starts the server or worker.

## Edit user interface components

Add shared components to `packages/ui`.
Use the shadcn command from the workspace root.

```sh
pnpm dlx shadcn@latest add button -c apps/web
```

Import shared components from `@workspace/ui/components`.
The root layout must include `TooltipProvider`.

## Change version history

Use Jujutsu (`jj`) for version history.
Use scoped change descriptions.

```sh
jj status
jj describe -m 'feeds,ui: add the feed detail view'
```

## Run tests

Run the content tests with this command.
Database tests stay disabled until you set their connection values.

```sh
pnpm test
```

Use a separate test database.
Run database setup before you start the test server.
Set `TEST_DATABASE_URL` to that database to test AI and RSS operations.
These tests replace provider calls with test responses.
They do not use a paid provider.

Set `TEST_BASE_URL` to the test server address to test authentication and feed access.
Set `DATABASE_URL` to the test database.
Set `STELLAR_ADMIN_USERNAME` and `STELLAR_ADMIN_PASSWORD` to the test administrator's credentials.
The tests create temporary accounts and remove them at the end.

Use Playwright to test the browser interface.
Install its Chromium browser first.
Set `TEST_APP_ORIGIN` to the test server address.
Set `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD` to the test administrator's credentials.

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```
