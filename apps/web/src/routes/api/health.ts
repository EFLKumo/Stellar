import { createFileRoute } from "@tanstack/react-router"
import { handleHealth } from "@/server/http"
export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: ({ request }) => handleHealth(request) } },
})
