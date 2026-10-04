import {
  Add01Icon,
  AiChat01Icon,
  Bookmark02Icon,
  File01Icon,
  Globe02Icon,
  Logout01Icon,
  Moon02Icon,
  RssIcon,
  SparklesIcon,
  StarIcon,
  Sun03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { type ReactNode, useEffect, useState } from "react"
import { signOut, useOperation } from "@/lib/client"
import type { AppData } from "@/shared/contracts"

export type View =
  | "all"
  | "public"
  | "saved"
  | "ai"
  | "subscriptions"
  | "chat"
  | "admin"
export const viewTitles: Record<View, string> = {
  all: "Your feed",
  public: "Public space",
  saved: "Saved for later",
  ai: "Picked for you",
  subscriptions: "Sources & preferences",
  chat: "Stellar assistant",
  admin: "People",
}
const navigation = [
  { id: "all", label: "Your feed", icon: File01Icon },
  { id: "ai", label: "Picked for you", icon: SparklesIcon },
  { id: "public", label: "Public space", icon: Globe02Icon },
  { id: "saved", label: "Saved for later", icon: Bookmark02Icon },
] as const

export function AppShell({
  data,
  view,
  onViewChange,
  onSubmit,
  onSignOut,
  children,
}: {
  data: AppData
  view: View
  onViewChange: (view: View) => void
  onSubmit: () => void
  onSignOut: () => void
  children: ReactNode
}) {
  const { run, busy } = useOperation()
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const preference = localStorage.getItem("stellar-theme")
    const value =
      preference === "dark" ||
      (preference === null &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    setDark(value)
    document.documentElement.classList.toggle("dark", value)
  }, [])
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
    >
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                onClick={() => onViewChange("all")}
                tooltip="Stellar"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={StarIcon}
                  strokeWidth={1.5}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">Stellar</span>
                  <span className="text-xs text-muted-foreground">
                    A space for good ideas
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarNavigation
          data={data}
          view={view}
          onViewChange={onViewChange}
        />
        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip={data.user.name}>
                <Avatar className="size-8">
                  <AvatarFallback>
                    {data.user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex flex-col gap-0.5">
                  <span>{data.user.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {data.user.username ?? data.user.email}
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                disabled={busy}
                onClick={() => run(signOut, onSignOut)}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={Logout01Icon}
                  strokeWidth={1.6}
                />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="truncate text-sm font-medium">
              {viewTitles[view]}
            </span>
            {view === "ai" && <Badge variant="secondary">AI</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label={dark ? "Use light theme" : "Use dark theme"}
                onClick={() => {
                  const value = !dark
                  setDark(value)
                  document.documentElement.classList.toggle("dark", value)
                  localStorage.setItem(
                    "stellar-theme",
                    value ? "dark" : "light",
                  )
                }}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={dark ? Sun03Icon : Moon02Icon}
                  strokeWidth={1.6}
                />
              </TooltipTrigger>
              <TooltipContent>
                {dark ? "Light theme" : "Dark theme"}
              </TooltipContent>
            </Tooltip>
            <Button size="sm" onClick={onSubmit}>
              <HugeiconsIcon
                aria-hidden="true"
                icon={Add01Icon}
                data-icon="inline-start"
                strokeWidth={1.6}
              />
              <span>Add feed</span>
            </Button>
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

function SidebarNavigation({
  data,
  view,
  onViewChange,
}: {
  data: AppData
  view: View
  onViewChange: (view: View) => void
}) {
  const { setOpenMobile } = useSidebar()
  const select = (next: View) => {
    onViewChange(next)
    setOpenMobile(false)
  }
  const aiCount = data.feeds.filter(
    (feed) => feed.origin === "ai" && feed.interested === null,
  ).length
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Library</SidebarGroupLabel>
        <SidebarMenu>
          {navigation.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                tooltip={item.label}
                isActive={view === item.id}
                onClick={() => select(item.id)}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={item.icon}
                  strokeWidth={1.6}
                />
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.id === "ai" && aiCount > 0 && (
                <SidebarMenuBadge>{aiCount}</SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Discover</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sources & preferences"
              isActive={view === "subscriptions"}
              onClick={() => select("subscriptions")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={RssIcon}
                strokeWidth={1.6}
              />
              <span>Sources & preferences</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Stellar assistant"
              isActive={view === "chat"}
              onClick={() => select("chat")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={AiChat01Icon}
                strokeWidth={1.6}
              />
              <span>Stellar assistant</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {data.user.role === "admin" && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="People"
                isActive={view === "admin"}
                onClick={() => select("admin")}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={UserGroupIcon}
                  strokeWidth={1.6}
                />
                <span>People</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  )
}

export function PageLayout({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-7 px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}
