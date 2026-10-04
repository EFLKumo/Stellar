import { definePlugin } from "nitro"
import { appRuntime } from "./runtime"
export default definePlugin((app) => {
  app.hooks.hook("close", () => appRuntime.dispose())
})
