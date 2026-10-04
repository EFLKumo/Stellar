import {
  Add01Icon,
  Bookmark02Icon,
  File01Icon,
  Link01Icon,
  Message01Icon,
  Search01Icon,
  Share08Icon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
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
  EmptyContent,
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { useEffect, useState } from "react"
import {
  PageLayout,
  type View,
  viewTitles,
} from "@/components/layout/app-shell"
import { Markdown } from "@/components/markdown"
import { ModelPicker } from "@/components/model-picker"
import { api, useOperation } from "@/lib/client"
import type { AppData, FeedDetail, FeedView } from "@/shared/contracts"

export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value),
  )
const descriptions: Record<string, string> = {
  all: "Everything you collect, and ideas shared with you.",
  public: "Good ideas grow when you share them.",
  saved: "A quiet place for the articles you want to revisit.",
  ai: "Articles selected from your sources, shaped by your interests.",
}

export function FeedList({
  data,
  view,
  onOpen,
  onSubmit,
}: {
  data: AppData
  view: Extract<View, "all" | "public" | "saved" | "ai">
  onOpen: (id: string) => void
  onSubmit: () => void
}) {
  const [feeds, setFeeds] = useState<FeedView[]>(data.feeds)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const { run, busy } = useOperation()
  useEffect(() => {
    if (view === "all" && !query.trim()) {
      setFeeds(data.feeds)
      return
    }
    let cancel: (() => void) | undefined
    const timer = setTimeout(() => {
      setError("")
      cancel = run(
        api({ action: "listFeeds", view, query }),
        setFeeds,
        (failure) => setError(failure.message),
      )
    }, 180)
    return () => {
      clearTimeout(timer)
      cancel?.()
    }
  }, [view, query, data.feeds, run])
  return (
    <PageLayout
      title={viewTitles[view]}
      description={descriptions[view] ?? ""}
      action={
        <Badge variant="outline">
          {feeds.length} {feeds.length === 1 ? "article" : "articles"}
        </Badge>
      }
    >
      <InputGroup>
        <InputGroupAddon>
          <HugeiconsIcon
            aria-hidden="true"
            icon={Search01Icon}
            strokeWidth={1.6}
          />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Search your feed…"
          aria-label="Search feeds"
          value={query}
          onValueChange={setQuery}
        />
        <InputGroupAddon align="inline-end">
          {busy && <Spinner />}
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Cannot load feeds</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : feeds.length === 0 ? (
        <Empty className="min-h-72">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon
                aria-hidden="true"
                icon={view === "ai" ? SparklesIcon : File01Icon}
              />
            </EmptyMedia>
            <EmptyTitle>
              {query
                ? "No matching articles"
                : view === "ai"
                  ? "Your discoveries start here"
                  : "Make room for your first idea"}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? "Try a different search."
                : view === "ai"
                  ? "Add an RSS source and tell Stellar what you want to read. Matching articles will appear here."
                  : view === "saved"
                    ? "Save an article to find it here later."
                    : "Add a link or write a note. Your collection starts with one feed."}
            </EmptyDescription>
          </EmptyHeader>
          {!query && view === "all" && (
            <EmptyContent>
              <Button onClick={onSubmit}>
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={Add01Icon}
                  data-icon="inline-start"
                />
                Add your first feed
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <ItemGroup>
          {feeds.map((feed) => (
            <Item
              key={feed.id}
              render={
                <a
                  href={`/?feed=${encodeURIComponent(feed.id)}`}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpen(feed.id)
                  }}
                />
              }
              className="py-4"
            >
              <ItemHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {feed.url
                      ? new URL(feed.url).hostname.replace(/^www\./, "")
                      : "Markdown"}
                  </Badge>
                  {feed.origin === "ai" && (
                    <Badge variant="secondary">
                      <HugeiconsIcon
                        aria-hidden="true"
                        icon={SparklesIcon}
                        data-icon="inline-start"
                      />
                      Picked for you
                    </Badge>
                  )}
                  {feed.isPublic && <Badge variant="outline">Public</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {dateLabel(feed.createdAt)}
                </span>
              </ItemHeader>
              <ItemContent>
                <ItemTitle>{feed.title}</ItemTitle>
                <ItemDescription>
                  {feed.summary ??
                    feed.content.replace(/[#*_`>]/g, "").slice(0, 220)}
                </ItemDescription>
              </ItemContent>
              <ItemFooter>
                <span className="text-xs text-muted-foreground">
                  {feed.authorName}
                </span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {feed.interested !== null && (
                    <span>
                      {feed.interested ? "Interested" : "Not interested"}
                    </span>
                  )}
                  {feed.saved && (
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={Bookmark02Icon}
                      className="size-3.5"
                    />
                  )}
                  {feed.commentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <HugeiconsIcon
                        aria-hidden="true"
                        icon={Message01Icon}
                        className="size-3.5"
                      />
                      {feed.commentCount}
                    </span>
                  )}
                </div>
              </ItemFooter>
            </Item>
          ))}
        </ItemGroup>
      )}
    </PageLayout>
  )
}

export function SubmitFeed({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  onCreated: (id: string) => void
}) {
  const [kind, setKind] = useState("link")
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const { run, busy } = useOperation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to your feed</DialogTitle>
          <DialogDescription>
            Keep a link or an idea you want to return to.
          </DialogDescription>
        </DialogHeader>
        <form
          id="submit-feed"
          onSubmit={(event) => {
            event.preventDefault()
            run(
              api({
                action: "submitFeed",
                ...(kind === "link"
                  ? { url: url.trim() }
                  : { title: title.trim(), content }),
              }),
              (result) => {
                onOpenChange(false)
                setUrl("")
                setTitle("")
                setContent("")
                if (result.duplicate)
                  toast.add({
                    title: "Already in the public space",
                    description: "The existing feed is open.",
                    type: "info",
                  })
                onCreated(result.id)
              },
            )
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>Feed type</FieldLabel>
              <ToggleGroup
                value={[kind]}
                onValueChange={(value) => {
                  if (value[0]) setKind(value[0])
                }}
                variant="outline"
              >
                <ToggleGroupItem value="link">
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={Link01Icon}
                    data-icon="inline-start"
                  />
                  Link
                </ToggleGroupItem>
                <ToggleGroupItem value="markdown">
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={File01Icon}
                    data-icon="inline-start"
                  />
                  Markdown
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {kind === "link" ? (
              <Field>
                <FieldLabel htmlFor="feed-url">Article URL</FieldLabel>
                <Input
                  id="feed-url"
                  type="url"
                  autoFocus
                  placeholder="https://…"
                  required
                  value={url}
                  onValueChange={setUrl}
                />
                <FieldDescription>
                  Stellar will read the article. Existing public links open as
                  one feed.
                </FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="feed-title">Title</FieldLabel>
                  <Input
                    id="feed-title"
                    maxLength={300}
                    required
                    value={title}
                    onValueChange={setTitle}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="feed-markdown">Markdown</FieldLabel>
                  <Textarea
                    id="feed-markdown"
                    className="min-h-48"
                    maxLength={50000}
                    required
                    placeholder="Write your idea…"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                  />
                </Field>
              </>
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="submit-feed" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}Add feed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FeedReader({
  id,
  data,
  onClose,
  onChanged,
  onOpen,
}: {
  id: string | undefined
  data: AppData
  onClose: () => void
  onChanged: () => void
  onOpen: (id: string) => void
}) {
  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {id ? (
          <ReaderContent
            key={id}
            id={id}
            data={data}
            onChanged={onChanged}
            onOpen={onOpen}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>Article</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ReaderContent({
  id,
  data,
  onChanged,
  onOpen,
}: {
  id: string
  data: AppData
  onChanged: () => void
  onOpen: (id: string) => void
}) {
  const [feed, setFeed] = useState<FeedDetail | null>(null)
  const [error, setError] = useState("")
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "")
  const [language, setLanguage] = useState("English")
  const [recipient, setRecipient] = useState("")
  const [forwardOpen, setForwardOpen] = useState(false)
  const [comment, setComment] = useState("")
  const [tab, setTab] = useState("article")
  const { run, busy } = useOperation()
  useEffect(
    () =>
      run(api({ action: "getFeed", id }), setFeed, (failure) =>
        setError(failure.message),
      ),
    [id, run],
  )
  const refresh = () => {
    run(api({ action: "getFeed", id }), setFeed)
    onChanged()
  }
  if (!feed)
    return (
      <>
        <SheetHeader>
          <SheetTitle>
            {error ? "Cannot open this feed" : "Loading article…"}
          </SheetTitle>
          <SheetDescription>
            {error || "Your article will open here."}
          </SheetDescription>
        </SheetHeader>
        {!error && (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
      </>
    )
  return (
    <>
      <SheetHeader className="pr-12">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">
            {feed.isPublic ? "Public" : "Private"}
          </Badge>
          {feed.origin === "ai" && (
            <Badge variant="secondary">AI discovery</Badge>
          )}
        </div>
        <SheetTitle>{feed.title}</SheetTitle>
        <SheetDescription>
          {feed.authorName} · {dateLabel(feed.createdAt)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={feed.saved ? "secondary" : "outline"}
            disabled={busy}
            onClick={() =>
              run(api({ action: "saveFeed", id, saved: !feed.saved }), () => {
                setFeed({ ...feed, saved: !feed.saved })
                onChanged()
              })
            }
          >
            <HugeiconsIcon
              aria-hidden="true"
              icon={Bookmark02Icon}
              data-icon="inline-start"
            />
            {feed.saved ? "Saved" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setForwardOpen(true)}
          >
            <HugeiconsIcon
              aria-hidden="true"
              icon={Share08Icon}
              data-icon="inline-start"
            />
            Forward
          </Button>
          {feed.url && (
            <Button
              size="sm"
              variant="ghost"
              render={
                <a href={feed.url} target="_blank" rel="noopener noreferrer" />
              }
              nativeButton={false}
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={Link01Icon}
                data-icon="inline-start"
              />
              Original article
            </Button>
          )}
        </div>
        {feed.origin === "ai" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Was this a good pick? Your response helps Stellar learn.
            </p>
            <ToggleGroup
              variant="outline"
              value={
                feed.interested === null ? [] : [feed.interested ? "yes" : "no"]
              }
              disabled={busy}
              onValueChange={(values) => {
                const value = values[0]
                if (value)
                  run(
                    api({
                      action: "feedback",
                      id,
                      interested: value === "yes",
                    }),
                    () => {
                      setFeed({ ...feed, interested: value === "yes" })
                      onChanged()
                    },
                  )
              }}
            >
              <ToggleGroupItem value="yes">
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={ThumbsUpIcon}
                  data-icon="inline-start"
                />
                Interested
              </ToggleGroupItem>
              <ToggleGroupItem value="no">
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={ThumbsDownIcon}
                  data-icon="inline-start"
                />
                Not interested
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
          <TabsList>
            <TabsTrigger value="article">Article</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="translation">Translation</TabsTrigger>
          </TabsList>
          <TabsContent value="article">
            <div className="py-4">
              <Markdown>
                {feed.content ||
                  "The article text is not available. Open the original link to read it."}
              </Markdown>
            </div>
          </TabsContent>
          <TabsContent value="summary">
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <ModelPicker
                  models={data.models}
                  value={modelId}
                  onChange={setModelId}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  disabled={busy || !modelId}
                  onClick={() =>
                    run(api({ action: "summarize", id, modelId }), (result) => {
                      setFeed({ ...feed, summary: result.summary })
                      onChanged()
                    })
                  }
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={SparklesIcon}
                      data-icon="inline-start"
                    />
                  )}
                  {feed.summary ? "Summarize again" : "Summarize"}
                </Button>
              </div>
              {feed.summary ? (
                <Markdown>{feed.summary}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose a model to find the main ideas.
                </p>
              )}
            </div>
          </TabsContent>
          <TabsContent value="translation">
            <div className="flex flex-col gap-4 py-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="translation-language">
                    Translate into
                  </FieldLabel>
                  <Input
                    id="translation-language"
                    value={language}
                    maxLength={80}
                    onValueChange={setLanguage}
                  />
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap items-center gap-2">
                <ModelPicker
                  models={data.models}
                  value={modelId}
                  onChange={setModelId}
                  disabled={busy}
                />
                <Button
                  size="sm"
                  disabled={busy || !modelId || !language.trim()}
                  onClick={() =>
                    run(
                      api({ action: "translate", id, modelId, language }),
                      (result) => {
                        setFeed({
                          ...feed,
                          translation: result.translation,
                          language,
                        })
                        onChanged()
                      },
                    )
                  }
                >
                  {busy && <Spinner data-icon="inline-start" />}Translate
                </Button>
              </div>
              {feed.translation && (
                <>
                  <Badge variant="outline">{feed.language}</Badge>
                  <Markdown>{feed.translation}</Markdown>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <Separator />
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">
            Conversation · {feed.comments.length}
          </h2>
          {feed.isPublic ? (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  run(
                    api({ action: "comment", id, content: comment.trim() }),
                    () => {
                      setComment("")
                      refresh()
                    },
                  )
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="comment" className="sr-only">
                      Your comment
                    </FieldLabel>
                    <Textarea
                      id="comment"
                      placeholder="Add to the conversation…"
                      required
                      maxLength={5000}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <Button
                      size="sm"
                      type="submit"
                      disabled={busy || !comment.trim()}
                    >
                      Post comment
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
              {feed.comments.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <Avatar className="size-7">
                    <AvatarFallback>
                      {item.authorName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {item.authorName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {dateLabel(item.createdAt)}
                      </span>
                    </div>
                    <Markdown>{item.content}</Markdown>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <Alert>
              <AlertTitle>A private idea, for now</AlertTitle>
              <AlertDescription>
                Forward this feed to someone to make it public and open a
                conversation.
              </AlertDescription>
            </Alert>
          )}
        </section>
      </div>
      <Dialog open={forwardOpen} onOpenChange={setForwardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forward this feed</DialogTitle>
            <DialogDescription>
              Forwarding makes this feed public. All users can read it and
              comment.
            </DialogDescription>
          </DialogHeader>
          <form
            id="forward-feed"
            onSubmit={(event) => {
              event.preventDefault()
              run(
                api({ action: "forwardFeed", id, toUserId: recipient }),
                (result) => {
                  setForwardOpen(false)
                  if (result.id === id) refresh()
                  else {
                    onChanged()
                    onOpen(result.id)
                  }
                  toast.add({ title: "Feed forwarded", type: "success" })
                },
              )
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="recipient">Send to</FieldLabel>
                <NativeSelect
                  id="recipient"
                  className="w-full"
                  value={recipient}
                  required
                  onChange={(event) => setRecipient(event.target.value)}
                >
                  <NativeSelectOption value="">
                    Choose a person
                  </NativeSelectOption>
                  {data.users
                    .filter((user) => user.id !== data.user.id)
                    .map((user) => (
                      <NativeSelectOption key={user.id} value={user.id}>
                        {user.name}
                        {user.username ? ` (@${user.username})` : ""}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="submit"
              form="forward-feed"
              disabled={busy || !recipient}
            >
              {busy && <Spinner data-icon="inline-start" />}Forward & make
              public
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
