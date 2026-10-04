import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Schedule } from "effect"
import { Ai } from "./ai"
import { AppConfig } from "./config"
import { Database } from "./database"
import { pollSubscriptions } from "./rss"

const workerLive = Ai.layer.pipe(
  Layer.provideMerge(Database.layer),
  Layer.provideMerge(AppConfig.layer),
)
const worker = pollSubscriptions.pipe(
  Effect.catch((error) =>
    Effect.logWarning("The RSS check failed.", { error: error.message }),
  ),
  Effect.repeat(Schedule.spaced("30 seconds")),
)
NodeRuntime.runMain(worker.pipe(Effect.provide(workerLive)))
