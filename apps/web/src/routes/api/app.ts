import { createFileRoute } from "@tanstack/react-router"
import { handleApp } from "@/server/http"
export const Route = createFileRoute("/api/app")({
  server: { handlers: { POST: ({ request }) => handleApp(request) } },
})
