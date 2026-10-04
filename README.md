# Stellar

Stellar stores links and Markdown text as feeds.
Users can use AI models to make summaries and translations.
The RSS worker selects articles with each user's stored preferences.
Users can forward feeds and add comments to public feeds.
Only an administrator can create user accounts.

## Deploy

Install Podman, `podman-compose`, Python 3, `python-dotenv`, and curl.
Copy the configuration file.

```sh
cp .env.example .env
```

Set the AI provider keys in `.env`.
Then start the deployment.

```sh
./scripts/deploy.sh
```

Open `http://localhost:8080`.
Read the administrator name and password from `.env`.

See [Deployment](docs/deployment.md) for domain names, HTTPS, backup, and restart procedures.
See [Configuration](docs/configuration.md) for environment variables.
See [Architecture](docs/architecture.md) for the program structure.
See [Development](docs/development.md) for local commands.
