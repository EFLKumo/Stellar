import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

// Run against an isolated database with the initial administrator account.
const adminIdentifier = process.env.TEST_ADMIN_EMAIL ?? "admin@example.com"
const adminPassword =
  process.env.TEST_ADMIN_PASSWORD ?? "stellar-test-password-0001"

test("collect, curate, and share a feed across two accounts", async ({
  page,
}) => {
  const errors: string[] = []
  let signedIn = false
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() !== "error") return
    if (
      !signedIn &&
      message.text().includes("401") &&
      message.location().url.includes("/api/app")
    )
      return
    errors.push(message.text())
  })
  const suffix = Date.now().toString(36)
  const title = `Reading notes ${suffix}`
  const personName = `Reader ${suffix}`
  const username = `reader_${suffix}`
  const preferences = `I like research about software reliability and clear interface design. Reading list: ${suffix}.`

  await page.goto("/")
  await page.getByLabel("Username or email").fill(adminIdentifier)
  await page.getByLabel("Password", { exact: true }).fill(adminPassword)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Your feed", exact: true }),
  ).toBeVisible()
  signedIn = true

  await page.getByRole("button", { name: "Add feed", exact: true }).click()
  const submit = page.getByRole("dialog", { name: "Add to your feed" })
  await submit.getByRole("button", { name: "Markdown", exact: true }).click()
  await submit.getByLabel("Title", { exact: true }).fill(title)
  await submit
    .getByLabel("Markdown", { exact: true })
    .fill(
      "## A note on reliable systems\n\nSmall services are easier to inspect. **Cancellation matters.**\n\n- Keep state explicit.\n- Test user actions.",
    )
  await submit.getByRole("button", { name: "Add feed", exact: true }).click()
  const reader = page.getByRole("dialog", { name: title, exact: true })
  await expect(
    reader.getByRole("heading", { name: "A note on reliable systems" }),
  ).toBeVisible()
  await reader.getByRole("button", { name: "Save", exact: true }).click()
  await expect(
    reader.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(reader).not.toBeVisible()

  await page
    .getByRole("button", { name: "Saved for later", exact: true })
    .click()
  await expect(page.getByRole("link").filter({ hasText: title })).toBeVisible()
  await page
    .getByRole("button", { name: "Sources & preferences", exact: true })
    .click()
  await page.getByLabel("Your reading preferences").fill(preferences)
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Save preferences", exact: true }),
  ).toBeDisabled()

  await page
    .getByRole("button", { name: "Add RSS source", exact: true })
    .click()
  const sourceDialog = page.getByRole("dialog", { name: "Add an RSS source" })
  await sourceDialog
    .getByLabel("RSS or Atom URL")
    .fill(`https://1.1.1.1/feed.xml?test=${suffix}`)
  await sourceDialog.getByLabel("Name (optional)").fill(`Research ${suffix}`)
  await sourceDialog
    .getByRole("button", { name: "Add source", exact: true })
    .click()
  const sourceSwitch = page.getByRole("switch", {
    name: `Enable Research ${suffix}`,
  })
  await expect(sourceSwitch).toBeChecked()
  await sourceSwitch.click()
  await expect(sourceSwitch).not.toBeChecked()
  await page.getByRole("button", { name: `Remove Research ${suffix}` }).click()
  await expect(sourceSwitch).not.toBeVisible()
  await page.reload()
  await page
    .getByRole("button", { name: "Sources & preferences", exact: true })
    .click()
  await expect(page.getByLabel("Your reading preferences")).toHaveValue(
    preferences,
  )

  await page
    .getByRole("button", { name: "Stellar assistant", exact: true })
    .click()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await expect(page.getByLabel("Message Stellar")).toBeVisible()
  const conversationId = await page
    .getByRole("combobox", { name: "Conversation" })
    .inputValue()
  expect(conversationId).not.toBe("")
  await page.reload()
  await page
    .getByRole("button", { name: "Stellar assistant", exact: true })
    .click()
  await expect(
    page.getByRole("combobox", { name: "Conversation" }),
  ).toHaveValue(conversationId)
  await expect(page.getByLabel("Message Stellar")).toBeVisible()
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click()
  await expect(
    page.getByText("Follow a thought", { exact: true }),
  ).toBeVisible()

  await page.getByRole("button", { name: "People", exact: true }).click()
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  const userDialog = page.getByRole("dialog", { name: "Create an account" })
  await userDialog.getByLabel("Name", { exact: true }).fill(personName)
  await userDialog.getByLabel("Username", { exact: true }).fill(username)
  await userDialog
    .getByLabel("Email", { exact: true })
    .fill(`${username}@example.com`)
  await userDialog.getByLabel("Password", { exact: true }).fill(adminPassword)
  await userDialog
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(
    page.getByRole("cell", { name: personName, exact: true }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Your feed", exact: true }).click()
  await page.getByRole("link").filter({ hasText: title }).click()
  await reader.getByRole("button", { name: "Forward", exact: true }).click()
  const forward = page.getByRole("dialog", { name: "Forward this feed" })
  await forward
    .getByLabel("Send to")
    .selectOption({ label: `${personName} (@${username})` })
  await forward
    .getByRole("button", { name: "Forward & make public", exact: true })
    .click()
  await expect(reader.getByText("Public", { exact: true })).toBeVisible()
  await reader
    .getByLabel("Your comment")
    .fill("This is a useful idea to discuss.")
  await reader
    .getByRole("button", { name: "Post comment", exact: true })
    .click()
  await expect(
    reader.getByText("This is a useful idea to discuss.", { exact: true }),
  ).toBeVisible()
  await expect(reader).toHaveCSS("width", "672px")
  const desktopAccess = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect
    .soft(
      desktopAccess.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    )
    .toEqual([])
  await page.screenshot({
    path: "/tmp/stellar-app-desktop.png",
    fullPage: true,
  })
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await page.getByLabel("Username or email").fill(username)
  await page.getByLabel("Password", { exact: true }).fill(adminPassword)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("link").filter({ hasText: title })).toBeVisible()
  await page
    .getByRole("button", { name: "Sources & preferences", exact: true })
    .click()
  await expect(page.getByLabel("Your reading preferences")).toHaveValue("")
  await expect(
    page.getByRole("button", { name: "People", exact: true }),
  ).not.toBeVisible()
  await page.getByRole("button", { name: "Your feed", exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("link").filter({ hasText: title })).toBeVisible()
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(overflows).toBe(false)
  await page.screenshot({ path: "/tmp/stellar-app-mobile.png", fullPage: true })
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await page.getByRole("button", { name: "Public space", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Public space", exact: true }),
  ).toBeVisible()
  await page.getByRole("link").filter({ hasText: title }).click()
  await expect(
    reader.getByText("This is a useful idea to discuss.", { exact: true }),
  ).toBeVisible()
  await expect(
    reader.getByRole("heading", { name: "A note on reliable systems" }),
  ).toBeVisible()
  await expect(reader).toHaveCSS("width", "390px")
  const mobileAccess = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect
    .soft(
      mobileAccess.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    )
    .toEqual([])
  await page.screenshot({
    path: "/tmp/stellar-app-mobile-reader.png",
    fullPage: true,
  })
  expect(errors).toEqual([])
})
