import { Add01Icon, Delete02Icon, RssIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { useEffect, useState } from "react"
import { dateLabel } from "@/components/feeds"
import { PageLayout } from "@/components/layout/app-shell"
import { Markdown } from "@/components/markdown"
import { api, useOperation } from "@/lib/client"
import type { AppData, UserView } from "@/shared/contracts"

export function Sources({
  data,
  onChanged,
}: {
  data: AppData
  onChanged: () => void
}) {
  const [preferences, setPreferences] = useState(data.profile.preferences)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const { run, busy } = useOperation()
  useEffect(
    () => setPreferences(data.profile.preferences),
    [data.profile.preferences],
  )
  return (
    <PageLayout
      title="Let your curiosity lead"
      description="Choose your sources. Tell Stellar what deserves your attention."
      action={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <HugeiconsIcon
            aria-hidden="true"
            icon={Add01Icon}
            data-icon="inline-start"
          />
          Add RSS source
        </Button>
      }
    >
      {data.models.length === 0 && (
        <Alert>
          <AlertTitle>AI models are not configured</AlertTitle>
          <AlertDescription>
            Ask your administrator to add an AI API key. Your sources and
            preferences can still be saved.
          </AlertDescription>
        </Alert>
      )}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Your sources</h2>
          <Badge variant="outline">{data.subscriptions.length} sources</Badge>
        </div>
        {data.subscriptions.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon aria-hidden="true" icon={RssIcon} />
              </EmptyMedia>
              <EmptyTitle>Follow ideas at their source</EmptyTitle>
              <EmptyDescription>
                Add an RSS or Atom feed. Stellar checks new articles and selects
                those that match your preferences.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {data.subscriptions.map((source) => (
              <Item variant="outline" key={source.id}>
                <ItemContent>
                  <ItemTitle>{source.title}</ItemTitle>
                  <ItemDescription>{source.url}</ItemDescription>
                  <p className="text-xs text-muted-foreground">
                    {source.lastCheckedAt
                      ? `Last checked ${dateLabel(source.lastCheckedAt)}`
                      : "Waiting for the first check"}
                  </p>
                  {source.lastError && (
                    <p className="text-xs text-destructive">
                      {source.lastError}
                    </p>
                  )}
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={`Enable ${source.title}`}
                    checked={source.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) =>
                      run(
                        api({
                          action: "updateSubscription",
                          id: source.id,
                          enabled,
                        }),
                        onChanged,
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${source.title}`}
                    disabled={busy}
                    onClick={() =>
                      run(
                        api({ action: "unsubscribe", id: source.id }),
                        onChanged,
                      )
                    }
                  >
                    <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
      <Separator />
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-medium">What would you like to read?</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            run(api({ action: "updatePreferences", preferences }), () => {
              onChanged()
              toast.add({ title: "Preferences saved", type: "success" })
            })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="preferences" className="sr-only">
                Your reading preferences
              </FieldLabel>
              <Textarea
                id="preferences"
                className="min-h-32"
                value={preferences}
                maxLength={8000}
                onChange={(event) => setPreferences(event.target.value)}
                placeholder="I'm interested in thoughtful writing about software, design, and science. Prefer original research to product announcements…"
              />
              <FieldDescription>
                Include topics, languages, and the kinds of articles you want to
                see less often.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Button
                type="submit"
                disabled={busy || preferences === data.profile.preferences}
              >
                {busy && <Spinner data-icon="inline-start" />}Save preferences
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">What Stellar has learned</h2>
        {data.profile.learnedPreferences ? (
          <Markdown>{data.profile.learnedPreferences}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            Mark discoveries as interested or not interested. Your reading
            profile will grow here.
          </p>
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an RSS source</DialogTitle>
            <DialogDescription>
              New articles will be checked against your reading preferences.
            </DialogDescription>
          </DialogHeader>
          <form
            id="add-source"
            onSubmit={(event) => {
              event.preventDefault()
              run(
                api({
                  action: "subscribe",
                  url: url.trim(),
                  ...(title.trim() ? { title: title.trim() } : {}),
                }),
                () => {
                  setOpen(false)
                  setUrl("")
                  setTitle("")
                  onChanged()
                },
              )
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="rss-url">RSS or Atom URL</FieldLabel>
                <Input
                  id="rss-url"
                  type="url"
                  required
                  placeholder="https://example.com/feed.xml"
                  value={url}
                  onValueChange={setUrl}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rss-title">Name (optional)</FieldLabel>
                <Input
                  id="rss-title"
                  maxLength={300}
                  value={title}
                  onValueChange={setTitle}
                />
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="submit" form="add-source" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}Add source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}

export function People({ onChanged }: { onChanged: () => void }) {
  const [users, setUsers] = useState<UserView[]>([])
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const { run, busy } = useOperation()
  useEffect(
    () =>
      run(api({ action: "listUsers" }), setUsers, (failure) =>
        setError(failure.message),
      ),
    [run],
  )
  return (
    <PageLayout
      title="A space for your people"
      description="Create accounts and give people access to Stellar."
      action={
        <Button size="sm" onClick={() => setOpen(true)}>
          <HugeiconsIcon
            aria-hidden="true"
            icon={Add01Icon}
            data-icon="inline-start"
          />
          Create account
        </Button>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Cannot load accounts</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.name}</TableCell>
              <TableCell>{user.username ?? "—"}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge
                  variant={user.role === "admin" ? "secondary" : "outline"}
                >
                  {user.role === "admin" ? "Administrator" : "User"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create an account</DialogTitle>
            <DialogDescription>
              Give the person their username and password so they can sign in.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-user"
            onSubmit={(event) => {
              event.preventDefault()
              run(
                api({
                  action: "createUser",
                  name: name.trim(),
                  email: email.trim(),
                  username: username.trim(),
                  password,
                  role,
                }),
                () => {
                  setOpen(false)
                  setName("")
                  setEmail("")
                  setUsername("")
                  setPassword("")
                  setRole("user")
                  run(api({ action: "listUsers" }), setUsers)
                  onChanged()
                  toast.add({ title: "Account created", type: "success" })
                },
              )
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-name">Name</FieldLabel>
                <Input
                  id="new-name"
                  autoComplete="off"
                  required
                  maxLength={120}
                  value={name}
                  onValueChange={setName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-username">Username</FieldLabel>
                <Input
                  id="new-username"
                  autoComplete="off"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_.]+"
                  value={username}
                  onValueChange={setUsername}
                />
                <FieldDescription>
                  Use letters, numbers, periods, or underscores.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-email">Email</FieldLabel>
                <Input
                  id="new-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onValueChange={setEmail}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-password">Password</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onValueChange={setPassword}
                />
                <FieldDescription>Use at least 12 characters.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Access</FieldLabel>
                <ToggleGroup
                  variant="outline"
                  value={[role]}
                  onValueChange={(values) => {
                    if (values[0] === "user" || values[0] === "admin")
                      setRole(values[0])
                  }}
                >
                  <ToggleGroupItem value="user">User</ToggleGroupItem>
                  <ToggleGroupItem value="admin">Administrator</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="submit" form="create-user" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
