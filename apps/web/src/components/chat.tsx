import { useChat } from "@ai-sdk/react"
import {
  Add01Icon,
  AiChat01Icon,
  ArrowUp02Icon,
  Delete02Icon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { Marker, MarkerContent } from "@workspace/ui/components/marker"
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Spinner } from "@workspace/ui/components/spinner"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Effect } from "effect"
import { useEffect, useMemo, useState } from "react"
import { Markdown } from "@/components/markdown"
import { ModelPicker } from "@/components/model-picker"
import { api, ClientError, useOperation } from "@/lib/client"
import type { AppData, ModelOption } from "@/shared/contracts"

const toolLabels: Record<string, string> = {
  listFeeds: "Find articles",
  readFeed: "Read an article",
  submitFeed: "Add a feed",
  subscribe: "Add an RSS source",
  listSubscriptions: "Read your sources",
  setSubscription: "Update a source",
  unsubscribe: "Remove a source",
  updatePreferences: "Update your preferences",
  listPeople: "Find a person",
  forwardFeed: "Forward a feed",
  comment: "Post a comment",
  saveFeed: "Save an article",
  feedback: "Learn from your feedback",
  summarize: "Summarize an article",
  translate: "Translate an article",
}

export function ChatPanel({
  data,
  onChanged,
  onOpenFeed,
}: {
  data: AppData
  onChanged: () => void
  onOpenFeed: (id: string) => void
}) {
  const [threadId, setThreadId] = useState(data.threads[0]?.id ?? "")
  const [thread, setThread] = useState<{
    id: string
    title: string
    messages: UIMessage[]
  } | null>(null)
  const [error, setError] = useState("")
  const { run, busy } = useOperation()
  useEffect(() => {
    setThread(null)
    setError("")
    if (!threadId) return
    return run(
      api({ action: "getThread", id: threadId }),
      setThread,
      (failure) => setError(failure.message),
    )
  }, [threadId, run])
  const create = () =>
    run(api({ action: "createThread" }), (result) => {
      setThreadId(result.id)
      onChanged()
    })
  return (
    <div className="flex h-[calc(100svh-5rem)] min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-8">
        <NativeSelect
          aria-label="Conversation"
          value={threadId}
          disabled={busy || !data.threads.length}
          onChange={(event) => setThreadId(event.target.value)}
        >
          {!threadId && (
            <NativeSelectOption value="">
              Choose a conversation
            </NativeSelectOption>
          )}
          {data.threads.map((item) => (
            <NativeSelectOption key={item.id} value={item.id}>
              {item.title}
            </NativeSelectOption>
          ))}
          {threadId && !data.threads.some((item) => item.id === threadId) && (
            <NativeSelectOption value={threadId}>
              New conversation
            </NativeSelectOption>
          )}
        </NativeSelect>
        <div className="flex items-center gap-2">
          {threadId && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete conversation"
              disabled={busy}
              onClick={() =>
                run(api({ action: "deleteThread", id: threadId }), () => {
                  setThreadId("")
                  setThread(null)
                  onChanged()
                })
              }
            >
              <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={create} disabled={busy}>
            <HugeiconsIcon
              aria-hidden="true"
              icon={Add01Icon}
              data-icon="inline-start"
            />
            New chat
          </Button>
        </div>
      </div>
      {error ? (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>Cannot open conversation</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : thread ? (
        <ChatConversation
          key={thread.id}
          thread={thread}
          models={data.models}
          onChanged={onChanged}
          onOpenFeed={onOpenFeed}
        />
      ) : threadId ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={AiChat01Icon} />
            </EmptyMedia>
            <EmptyTitle>Follow a thought</EmptyTitle>
            <EmptyDescription>
              Ask about your articles, discover patterns, or shape your reading
              preferences. Stellar can help manage your feeds and sources.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={create}
              disabled={busy || data.models.length === 0}
            >
              {busy && <Spinner data-icon="inline-start" />}Start a conversation
            </Button>
            {data.models.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ask your administrator to configure an AI model.
              </p>
            )}
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}

function ChatConversation({
  thread,
  models,
  onChanged,
  onOpenFeed,
}: {
  thread: { id: string; messages: UIMessage[] }
  models: ModelOption[]
  onChanged: () => void
  onOpenFeed: (id: string) => void
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "")
  const [input, setInput] = useState("")
  const { run } = useOperation()
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
      }),
    [],
  )
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: thread.id,
    messages: thread.messages,
    transport,
    onFinish: onChanged,
  })
  const busy = status === "submitted" || status === "streaming"
  useEffect(
    () => () => {
      void stop()
    },
    [stop],
  )
  const send = (text: string) => {
    if (!text.trim() || busy || !modelId) return
    setInput("")
    run(
      Effect.tryPromise({
        try: () =>
          sendMessage({ text }, { body: { threadId: thread.id, modelId } }),
        catch: (failure) =>
          new ClientError({
            message:
              failure instanceof Error
                ? failure.message
                : "Cannot send message.",
          }),
      }),
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={AiChat01Icon} />
            </EmptyMedia>
            <EmptyTitle>What caught your curiosity?</EmptyTitle>
            <EmptyDescription>
              Your feeds, sources, and reading profile are part of this
              conversation.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {[
              "Find connections between my recent articles.",
              "Help me refine my reading preferences.",
              "What should I read next?",
            ].map((prompt) => (
              <Button
                key={prompt}
                variant="outline"
                size="sm"
                onClick={() => send(prompt)}
                disabled={!modelId}
              >
                {prompt}
              </Button>
            ))}
          </EmptyContent>
        </Empty>
      ) : (
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-6 md:px-8">
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatMessage message={message} onOpenFeed={onOpenFeed} />
                  </MessageScrollerItem>
                ))}
                {status === "submitted" && (
                  <MessageScrollerItem messageId="thinking">
                    <Marker>
                      <MarkerContent>
                        <span className="shimmer">Thinking…</span>
                      </MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pb-5 pt-3 md:px-8">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Cannot complete the response</AlertTitle>
            <AlertDescription>
              {error.message}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    Effect.tryPromise({
                      try: () =>
                        regenerate({ body: { threadId: thread.id, modelId } }),
                      catch: () =>
                        new ClientError({
                          message: "Cannot retry the response.",
                        }),
                    }),
                  )
                }
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(input.trim())
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="chat-prompt" className="sr-only">
                Message Stellar
              </FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id="chat-prompt"
                  placeholder="Ask Stellar anything about your feeds…"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={2}
                  maxLength={20000}
                  disabled={busy || !modelId}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      send(input.trim())
                    }
                  }}
                />
                <InputGroupAddon align="block-end">
                  <ModelPicker
                    models={models}
                    value={modelId}
                    onChange={setModelId}
                    disabled={busy}
                  />
                  <div className="ml-auto">
                    {busy ? (
                      <InputGroupButton
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Stop response"
                        onClick={() => {
                          void stop()
                        }}
                      >
                        <HugeiconsIcon aria-hidden="true" icon={StopIcon} />
                      </InputGroupButton>
                    ) : (
                      <InputGroupButton
                        type="submit"
                        size="icon-sm"
                        variant="default"
                        aria-label="Send message"
                        disabled={!input.trim() || !modelId}
                      >
                        <HugeiconsIcon
                          aria-hidden="true"
                          icon={ArrowUp02Icon}
                        />
                      </InputGroupButton>
                    )}
                  </div>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          Check important facts. Press Enter to send, Shift + Enter for a new
          line.
        </p>
      </div>
    </div>
  )
}

function ChatMessage({
  message,
  onOpenFeed,
}: {
  message: UIMessage
  onOpenFeed: (id: string) => void
}) {
  const user = message.role === "user"
  return (
    <Message align={user ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{user ? "You" : "Stellar"}</MessageHeader>
        {message.parts.map((part, index) => {
          // AI SDK streams append-only parts. Tool calls have their own stable IDs.
          const partId =
            "toolCallId" in part
              ? part.toolCallId
              : `${message.id}-${part.type}-${index}`
          if (part.type === "text")
            return (
              <Bubble
                key={partId}
                variant={user ? "secondary" : "ghost"}
                align={user ? "end" : "start"}
              >
                <BubbleContent>
                  <Markdown>{part.text}</Markdown>
                </BubbleContent>
              </Bubble>
            )
          if (part.type === "reasoning")
            return (
              <Accordion key={partId}>
                <AccordionItem value="reasoning">
                  <AccordionTrigger>Thinking process</AccordionTrigger>
                  <AccordionContent>
                    <Markdown>{part.text}</Markdown>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )
          if (part.type === "source-url")
            return (
              <Button
                key={part.sourceId}
                size="sm"
                variant="link"
                render={
                  <a
                    href={part.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                nativeButton={false}
              >
                {part.title ?? new URL(part.url).hostname}
              </Button>
            )
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            const toolName =
              part.type === "dynamic-tool" && "toolName" in part
                ? String(part.toolName)
                : part.type.slice(5)
            const state = "state" in part ? part.state : ""
            const failed = state === "output-error"
            const complete = state === "output-available"
            return (
              <div key={partId} className="flex flex-col gap-1">
                <Marker>
                  <MarkerContent>
                    {!complete && !failed && <Spinner />}{" "}
                    {toolLabels[toolName] ?? "Use your library"} ·{" "}
                    {complete ? "Done" : failed ? "Failed" : "Working"}
                  </MarkerContent>
                </Marker>
                {complete && "output" in part && (
                  <ToolResult output={part.output} onOpenFeed={onOpenFeed} />
                )}
                {failed && "errorText" in part && (
                  <p className="text-xs text-destructive">
                    {String(part.errorText)}
                  </p>
                )}
              </div>
            )
          }
          return null
        })}
      </MessageContent>
    </Message>
  )
}

function ToolResult({
  output,
  onOpenFeed,
}: {
  output: unknown
  onOpenFeed: (id: string) => void
}) {
  const values = Array.isArray(output) ? output : [output]
  return (
    <div className="flex flex-col items-start gap-1">
      {values.slice(0, 6).map((value: unknown) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          typeof value.id !== "string"
        )
          return null
        if (!("title" in value) || typeof value.title !== "string") return null
        if (!("content" in value) && !("origin" in value)) return null
        const id = value.id
        return (
          <Button
            key={id}
            size="sm"
            variant="link"
            onClick={() => onOpenFeed(id)}
          >
            {value.title}
          </Button>
        )
      })}
    </div>
  )
}
