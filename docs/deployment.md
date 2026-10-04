# Deployment

## Terms

| Term | Meaning |
| --- | --- |
| Container | A process that runs with a separate file system and network. |
| Compose provider | A program that reads `compose.yaml` and starts containers. |
| Rootless Podman | Podman that runs without the root account. |
| DNS | Domain Name System. DNS connects a domain name to an IP address. |
| TLS | Transport Layer Security. TLS protects network connections. |
| Volume | Data storage that remains after a container stops. |

## Install the host tools

1. Install Podman with your operating system package manager.
2. Install `podman-compose`, Python 3, `python-dotenv`, curl, and Bash.
3. Confirm that Podman can run as your user.

```sh
podman info
podman-compose version
```

Podman uses an external Compose provider.
The deployment script selects `podman-compose` when it is installed.
The script uses `python-dotenv` to read and update `.env`.
This library is also a dependency of `podman-compose`.
To select another provider, set `PODMAN_COMPOSE_PROVIDER` to its executable path.
See the [Podman Compose instructions](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).

On macOS or Windows, start a Podman machine first.

```sh
podman machine init
podman machine start
```

## Start a local deployment

1. Copy `.env.example` to `.env`.
2. Set a provider key for each provider in `AI_MODELS`.
3. Set the first administrator's name and email address.
4. Run the deployment script.

```sh
cp .env.example .env
./scripts/deploy.sh
```

The script generates a secret for each empty password or authentication field.
It sets `.env` permissions to allow access only by the file owner.
It builds the application image and starts four containers.
The containers run PostgreSQL, the application, the RSS worker, and Caddy.
The script checks the database, application, site, and worker before it reports success.

Open `http://localhost:8080`.
Sign in with `STELLAR_ADMIN_USERNAME` and `STELLAR_ADMIN_PASSWORD` from `.env`.
Use the administration panel to create other accounts.
The application does not provide public account registration.

## Connect a public domain

1. Set the domain's DNS records to the server's public IP address.
2. Permit incoming TCP traffic on ports 80 and 443.
3. Permit incoming UDP traffic on port 443 to use HTTP/3.
4. Set these values in `.env`.

```dotenv
DOMAIN=feeds.example.com
APP_ORIGIN=https://feeds.example.com
HTTP_PORT=80
HTTPS_PORT=443
```

5. Permit rootless processes to bind the ports, if the host requires this change.

```sh
printf '%s\n' 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-stellar.conf
sudo sysctl --system
```

This host setting lets unprivileged processes bind ports 80 and above.
You can instead forward public ports 80 and 443 to host ports 8080 and 8443.
Keep `HTTP_PORT=8080` and `HTTPS_PORT=8443` when you use port forwarding.
See the [Podman port instructions](https://github.com/podman-container-tools/podman/blob/main/troubleshooting.md#48-pasta-fails-with-listen-failed-or-rootless-podman-fails-with-bind-permission-denied).

6. Run `./scripts/deploy.sh`.
7. Open the address in `APP_ORIGIN`.

Caddy gets and renews the TLS certificate automatically.
The public domain must reach this server on ports 80 and 443.
See the [Caddy HTTPS instructions](https://caddyserver.com/docs/quick-starts/https).
Certificate data remains in the `stellar_caddy_data` volume.

## Keep containers after a restart

On a Linux host with systemd, enable the Podman restart service.
Then enable user services when the user is not signed in.

```sh
systemctl --user enable podman-restart.service
sudo loginctl enable-linger "$USER"
```

The Compose file uses the `unless-stopped` restart policy.
Current Podman versions restart these containers after a host restart.
See the [Podman restart policy instructions](https://docs.podman.io/en/latest/markdown/podman-update.1.html#restart-policy).

## Read logs and stop containers

Read container state and logs.

```sh
podman compose ps
podman compose logs --tail=100 app worker
podman compose logs --tail=100 proxy
```

Stop the deployment.

```sh
podman compose down
```

This command keeps the named volumes.
Do not add `--volumes` unless you intend to delete stored data.

## Update the application

1. Make a database backup.
2. Get the new application files.
3. Run `./scripts/deploy.sh`.
4. Check the site and the worker logs.

The application applies database changes before the server starts.
The worker uses the same application image.

## Make a database backup

Create a backup file outside the container.
Protect the backup file because it contains user data.

```sh
umask 077
mkdir -p backups
podman compose exec -T database pg_dump -U stellar -d stellar -Fc > backups/stellar.dump
```

Copy `.env` and the backup file to separate protected storage.
The `.env` file contains the authentication secret.
Keep this secret when you restore the database.

## Restore a database backup

This procedure replaces the database contents.
Stop the application and the worker before you restore the backup.

```sh
podman compose stop app worker
podman compose exec -T database pg_restore -U stellar -d stellar --clean --if-exists < backups/stellar.dump
./scripts/deploy.sh
```

## Correct deployment errors

| Error | Action |
| --- | --- |
| No Compose provider | Install `podman-compose`. Run `podman-compose version`. |
| Podman machine stopped | Run `podman machine start`. |
| Permission denied on a host port | Use ports 8080 and 8443, or complete the domain port procedure. |
| Database authentication failed | Keep the original `POSTGRES_PASSWORD` for an existing database volume. |
| Site health check failed | Check `APP_ORIGIN`, DNS, host ports, and proxy logs. |
| Certificate request failed | Confirm that public ports 80 and 443 reach Caddy. |
| AI request failed | Check the provider key, model ID, provider limits, and worker logs. |

The database uses `stellar_database`.
PostgreSQL does not change an existing volume's password when you edit `.env`.
