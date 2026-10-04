import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useCallback, useEffect, useState } from "react"
import { ChatPanel } from "@/components/chat"
import { FeedList, FeedReader, SubmitFeed } from "@/components/feeds"
import { AppShell, type View } from "@/components/layout/app-shell"
import { People, Sources } from "@/components/settings"
import { api, useOperation } from "@/lib/client"
import type { AppData } from "@/shared/contracts"
import { Login } from "./login"

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { feed?: string } => ({
    ...(typeof search.feed === "string" ? { feed: search.feed } : {}),
  }),
  component: App,
})

function App() {
  const { feed } = Route.useSearch()
  const navigate = useNavigate()
  const [data, setData] = useState<AppData | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [error, setError] = useState("")
  const [view, setView] = useState<View>("all")
  const [submitOpen, setSubmitOpen] = useState(false)
  const { run } = useOperation()
  const refresh = useCallback(
    () =>
      run(
        api({ action: "bootstrap" }),
        (result) => {
          setData(result)
          setUnauthenticated(false)
          setError("")
        },
        (failure) => {
          if (failure.status === 401) {
            setData(null)
            setUnauthenticated(true)
          } else setError(failure.message)
        },
      ),
    [run],
  )
  useEffect(refresh, [refresh])
  const openFeed = (id: string) => {
    void navigate({ to: "/", search: { feed: id } })
  }
  if (unauthenticated)
    return (
      <Login
        onSuccess={() => {
          refresh()
        }}
      />
    )
  if (!data)
    return (
      <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-6 px-6 py-12">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Cannot connect to Stellar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button variant="outline" onClick={() => refresh()}>
              Try again
            </Button>
          </Alert>
        ) : (
          <>
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </>
        )}
      </main>
    )
  return (
    <AppShell
      data={data}
      view={view}
      onViewChange={setView}
      onSubmit={() => setSubmitOpen(true)}
      onSignOut={() => {
        setData(null)
        setUnauthenticated(true)
      }}
    >
      {view === "subscriptions" ? (
        <Sources data={data} onChanged={refresh} />
      ) : view === "chat" ? (
        <ChatPanel data={data} onChanged={refresh} onOpenFeed={openFeed} />
      ) : view === "admin" && data.user.role === "admin" ? (
        <People onChanged={refresh} />
      ) : (
        <FeedList
          key={view}
          data={data}
          view={view === "admin" ? "all" : view}
          onOpen={openFeed}
          onSubmit={() => setSubmitOpen(true)}
        />
      )}
      <SubmitFeed
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onCreated={(id) => {
          refresh()
          openFeed(id)
        }}
      />
      <FeedReader
        onOpen={openFeed}
        id={feed}
        data={data}
        onClose={() => {
          void navigate({ to: "/", search: {} })
        }}
        onChanged={refresh}
      />
    </AppShell>
  )
}
