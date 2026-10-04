export type ModelOption = { id: string; name: string; provider: string }
export type UserView = {
  id: string
  name: string
  email: string
  username: string | null
  role: string
}
export type FeedView = {
  id: string
  title: string
  url: string | null
  content: string
  summary: string | null
  translation: string | null
  language: string | null
  authorId: string
  authorName: string
  kind: "link" | "markdown"
  origin: "user" | "ai"
  isPublic: boolean
  createdAt: string
  interested: boolean | null
  saved: boolean
  commentCount: number
}
export type FeedDetail = FeedView & {
  comments: {
    id: string
    authorName: string
    content: string
    createdAt: string
  }[]
}
export type SubscriptionView = {
  id: string
  url: string
  title: string
  enabled: boolean
  lastCheckedAt: string | null
  lastError: string | null
}
export type ProfileView = { preferences: string; learnedPreferences: string }
export type ThreadView = { id: string; title: string; updatedAt: string }
export type AppData = {
  user: UserView
  models: ModelOption[]
  feeds: FeedView[]
  subscriptions: SubscriptionView[]
  profile: ProfileView
  users: Pick<UserView, "id" | "name" | "username">[]
  threads: ThreadView[]
}
export type CommandMap = {
  bootstrap: { input: Record<never, never>; output: AppData }
  listFeeds: {
    input: { view: "all" | "public" | "saved" | "ai"; query?: string }
    output: FeedView[]
  }
  getFeed: { input: { id: string }; output: FeedDetail }
  submitFeed: {
    input: { url?: string; content?: string; title?: string }
    output: { id: string; duplicate: boolean }
  }
  forwardFeed: {
    input: { id: string; toUserId: string }
    output: { id: string }
  }
  comment: { input: { id: string; content: string }; output: { id: string } }
  feedback: { input: { id: string; interested: boolean }; output: { ok: true } }
  saveFeed: { input: { id: string; saved: boolean }; output: { ok: true } }
  summarize: {
    input: { id: string; modelId: string }
    output: { summary: string }
  }
  translate: {
    input: { id: string; modelId: string; language: string }
    output: { translation: string }
  }
  subscribe: { input: { url: string; title?: string }; output: { id: string } }
  updateSubscription: {
    input: { id: string; enabled: boolean }
    output: { ok: true }
  }
  unsubscribe: { input: { id: string }; output: { ok: true } }
  updatePreferences: { input: { preferences: string }; output: ProfileView }
  listUsers: { input: Record<never, never>; output: UserView[] }
  createUser: {
    input: {
      email: string
      username: string
      name: string
      password: string
      role: "user" | "admin"
    }
    output: { id: string }
  }
  createThread: { input: Record<never, never>; output: ThreadView }
  getThread: {
    input: { id: string }
    output: { id: string; title: string; messages: import("ai").UIMessage[] }
  }
  deleteThread: { input: { id: string }; output: { ok: true } }
}
export type CommandName = keyof CommandMap
export type Command<K extends CommandName = CommandName> = K extends CommandName
  ? { action: K } & CommandMap[K]["input"]
  : never
