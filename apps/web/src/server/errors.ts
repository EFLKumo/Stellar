import { Data } from "effect"

export class AppError extends Data.TaggedError("AppError")<{
  message: string
  status: number
  cause?: unknown
}> {}
