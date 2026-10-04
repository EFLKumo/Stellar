import { Layer, ManagedRuntime } from "effect"
import { Ai } from "./ai"
import { Auth } from "./auth"
import { AppConfig } from "./config"
import { Database } from "./database"

export const databaseLive = Database.layer.pipe(
  Layer.provideMerge(AppConfig.layer),
)
export const appLive = Layer.merge(Ai.layer, Auth.layer).pipe(
  Layer.provideMerge(databaseLive),
)
export const appRuntime = ManagedRuntime.make(appLive)
