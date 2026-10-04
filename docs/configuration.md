# Configuration

Use one line for each value in `.env`.
Use the names in `.env.example`.
Do not publish `.env` or provider keys.

## Site and account values

| Name | Purpose |
| --- | --- |
| `DOMAIN` | Host name that Caddy serves. Use `localhost` for a local deployment. |
| `APP_ORIGIN` | Complete site address. Use the public HTTPS address for a domain. |
| `HTTP_PORT` | Host port for HTTP. The local default is `8080`. |
| `HTTPS_PORT` | Host port for HTTPS and HTTP/3. The local default is `8443`. |
| `STELLAR_ADMIN_EMAIL` | Email address for the first administrator. |
| `STELLAR_ADMIN_USERNAME` | User name for the first administrator. |
| `STELLAR_ADMIN_PASSWORD` | Password for the first administrator. The script generates a value for an empty field. |
| `BETTER_AUTH_SECRET` | Authentication secret. The script generates a value for an empty field. |
| `POSTGRES_PASSWORD` | Database password. The script generates a value for an empty field. |

Use at least 12 characters for an administrator password.
Use at least 32 characters for an authentication secret.
Use URL-safe characters for a database password.
The script uses random hexadecimal characters for generated secrets.
Do not change a database password only by editing `.env` after the first deployment.

The setup program creates the first administrator.
It does not reset an existing account's password at each start.
Create and manage later accounts in the administration panel.

## AI models

`AI_MODELS` is a JSON array.
Each item has four fields.

| Field | Purpose |
| --- | --- |
| `id` | Unique ID that Stellar stores for the model. |
| `name` | Model name that users see. |
| `provider` | `google`, `openai`, or `anthropic`. |
| `model` | Model ID from the provider. |

Put the JSON array on one line in `.env`.
Use single quotes around the array.

```dotenv
AI_MODELS='[{"id":"gemini-flash","name":"Gemini Flash","provider":"google","model":"gemini-flash-latest"}]'
GOOGLE_GENERATIVE_AI_API_KEY=your-provider-key
```

The Gemini alias selects the provider's current Flash model.
Select a fixed model ID when you require a specific model version.
See the [Gemini model list](https://ai.google.dev/gemini-api/docs/models).

Set `OPENAI_API_KEY` for OpenAI models.
Set `ANTHROPIC_API_KEY` for Anthropic models.
Users can select only the models in `AI_MODELS`.
Provider keys remain on the server.

## Worker values

| Name | Purpose |
| --- | --- |
| `RSS_POLL_SECONDS` | Time between RSS checks. The default is `900` seconds. |
| `RSS_CONCURRENCY` | Maximum number of subscriptions checked together. The default is `2`. |

Change these values to control RSS request volume.
The worker uses each user's stored preferences to select articles.

## Direct server values

Compose supplies these values to the application and worker.
Set them manually when you run the server outside Compose.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection address. |
| `BETTER_AUTH_URL` | Public authentication address. Compose uses `APP_ORIGIN`. |
| `HOST` | Server bind address. The container uses `0.0.0.0`. |
| `PORT` | Server port. The container uses `3000`. |
| `NODE_ENV` | Runtime mode. The container uses `production`. |
