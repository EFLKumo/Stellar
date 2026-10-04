# Architecture

## Terms

| Term | Meaning |
| --- | --- |
| Feed | A link or Markdown text stored in Stellar. |
| Feed state | Saved values for one user and one feed. |
| Profile | Stored preferences and learned reading interests for one user. |
| Public feed | A feed that other users can read. |
| RSS | Really Simple Syndication. An RSS source lists articles. |
| Effect | The library that controls dependencies, errors, tasks, and resource lifetimes. |
| Layer | An Effect value that constructs services and their dependencies. |
| Scope | An Effect resource lifetime. Resources close when the scope ends. |
| AI tool | A server function that the AI agent can request. |

## Program structure

React provides the user interface.
TanStack Start provides routes and the server build.
Shared shadcn components are in `packages/ui`.
The root React layout provides tooltips for the application.

Effect provides browser request control and server services.
React remains responsible for rendering and component state.
Server services use Effect dependency injection through layers.
Service dependencies have one implementation for each external system.

Drizzle stores application data in PostgreSQL.
Better Auth checks credentials and maintains sessions.
Only the administrator can create accounts.
The server checks the session for each protected request.

The Vercel AI SDK provides model access, streaming chat, and AI tools.
Model configuration and provider keys stay on the server.
AI tools use the signed-in user's access permissions.

## Feed rules

A new feed belongs to its author.
Forwarding a feed makes it public.
Other users can add comments to public feeds.
The server checks feed visibility before it returns content.

The server uses a normalized URL to find an existing public feed.
If a matching public feed exists, submission returns that feed.
The browser then opens the existing feed.
Markdown feeds do not use URL duplicate detection.

## AI and RSS

The AI can summarize feeds and translate their content.
The chat agent can read accessible feeds and operate on the user's subscriptions and profile.
The user profile remains in PostgreSQL.
Interest feedback changes the stored profile used for later article selection.
The worker retries unfinished profile updates after provider failures or interrupted requests.

The RSS worker runs separately from the web server.
It reads subscriptions and each user's preferences.
It asks the model to select articles and produce summaries.
It stores selected articles as AI feeds.
An RSS recommendation can reuse an existing public feed.
The user's feed state stores the AI summary and recommendation status.
The worker limits concurrent subscription checks with Effect.

## Lifetimes and interruption

Effect scopes own server resources.
Database connections close when their scope ends.
Request cancellation interrupts the corresponding Effect work.
AI requests receive the request's cancellation signal.
The worker uses the Effect Node runtime for startup and signal handling.
The runtime interrupts the worker before scoped resources close.

## Container structure

Compose starts the database, application, worker, and Caddy proxy.
The application and worker share one image.
Their entrypoint runs database setup before it starts the selected process.
PostgreSQL and Caddy use named volumes.
Only Caddy publishes host ports.
Caddy forwards application requests and supplies HTTPS for a public domain.
