import { StarIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { useState } from "react"
import { signIn, useOperation } from "@/lib/client"

export const Route = createFileRoute("/login")({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  return (
    <Login
      onSuccess={() => {
        void navigate({ to: "/" })
      }}
    />
  )
}

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const { run, busy } = useOperation()
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            icon={StarIcon}
            className="size-9"
            strokeWidth={1.5}
          />
          <span className="text-2xl font-semibold tracking-tight">Stellar</span>
          <p className="text-sm text-muted-foreground">
            A space for good ideas.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>
              Sign in to read, collect, and share.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="login-form"
              onSubmit={(event) => {
                event.preventDefault()
                setError("")
                run(signIn(identifier.trim(), password), onSuccess, (failure) =>
                  setError(failure.message),
                )
              }}
            >
              <FieldGroup>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="identifier">
                    Username or email
                  </FieldLabel>
                  <Input
                    id="identifier"
                    autoComplete="username"
                    autoFocus
                    required
                    value={identifier}
                    aria-invalid={Boolean(error)}
                    onValueChange={setIdentifier}
                  />
                </Field>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    aria-invalid={Boolean(error)}
                    onValueChange={setPassword}
                  />
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              type="submit"
              form="login-form"
              disabled={busy}
            >
              {busy && <Spinner data-icon="inline-start" />}Sign in
            </Button>
          </CardFooter>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Ask your administrator for an account.
        </p>
      </div>
    </main>
  )
}
