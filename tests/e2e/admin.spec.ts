import { expect, test, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test("admin: convite, usuário, suspensão e auditoria", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("admin_token", "e2e");
    sessionStorage.setItem("admin_exp", String(Date.now() + 3600_000));
  });

  let invites: unknown[] = [];
  let status = "active";
  const auditQueries: string[] = [];
  const profile = () => ({ userId: "u1", name: "Maria Silva", email: "maria@example.com", status, createdAt: "2026-10-01T12:00:00Z" });

  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const method = request.method();
    if (pathname === "/api/admin/invites" && method === "POST") {
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      invites = [{ inviteId: "i1", label: request.postDataJSON().label, status: "pending", createdAt: new Date().toISOString(), expiresAt }];
      return json(route, { token: "abc123", expiresAt }, 201);
    }
    if (pathname === "/api/admin/invites") return json(route, invites);
    if (pathname === "/api/admin/users") return json(route, [profile()]);
    if (pathname === "/api/admin/users/u1/suspend") {
      status = "suspended";
      return json(route, {});
    }
    if (pathname === "/api/admin/users/u1") {
      return json(route, { profile: profile(), account: { boxName: "Box Central", status: "ok" }, schedules: [], executions: [], sessions: [], audit: [] });
    }
    if (pathname === "/api/admin/audit") {
      auditQueries.push(search);
      const items = [
        { at: "2026-10-22T10:00:00Z", actorType: "admin", actorId: "a1", action: "user.suspend", targetType: "user", targetId: "u1", result: "ok" },
        { at: "2026-10-22T09:00:00Z", actorType: "user", actorId: "u1", action: "login", result: "ok" },
      ];
      const action = new URLSearchParams(search).get("action");
      return json(route, { items: action ? items.filter((i) => i.action === action) : items, truncated: false });
    }
    return json(route, { message: "not mocked" }, 500);
  });

  await page.goto("/admin/convites");
  await page.getByLabel("Rótulo (opcional)").fill("turma de outubro");
  await page.getByRole("button", { name: "Gerar convite" }).click();
  await expect(page.getByText("/convite#abc123")).toBeVisible();
  await expect(page.getByText(/^Expira em 0[45]:\d\d$/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "turma de outubro" })).toBeVisible();

  await page.getByRole("link", { name: "Usuários" }).click();
  await page.getByRole("link", { name: "Maria Silva" }).click();
  await expect(page.getByRole("heading", { name: "Maria Silva" })).toBeVisible();

  await page.getByRole("button", { name: "Suspender", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Confirmar suspender" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Digite o nome do usuário/).fill("Maria Silva");
  await expect(confirm).toBeDisabled();
  const suspend = page.waitForRequest("**/api/admin/users/u1/suspend");
  await page.getByLabel(/Motivo/).fill("abuso");
  await confirm.click();
  expect((await suspend).postDataJSON()).toEqual({ reason: "abuso" });
  await expect(page.getByText(/^Suspenso · criado em/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reativar" })).toBeVisible();

  await page.getByRole("link", { name: "Auditoria" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByLabel("Ação").fill("user.suspend");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "user.suspend" })).toBeVisible();
  expect(auditQueries.at(-1)).toContain("action=user.suspend");
});
