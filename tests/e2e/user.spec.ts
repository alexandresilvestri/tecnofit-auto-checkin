import { expect, test, type Page, type Route } from "@playwright/test";

type Sched = Record<string, unknown> & { scheduleId: string; active: boolean };

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockApi(page: Page) {
  let schedules: Sched[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const method = request.method();
    if (pathname === "/api/invites/check") return json(route, { valid: true });
    if (pathname === "/api/onboarding") return json(route, { ok: true });
    if (pathname === "/api/auth/login") return json(route, { message: "Credenciais inválidas." }, 401);
    if (pathname === "/api/auth/logout") return json(route, {});
    if (pathname === "/api/me") return json(route, { name: "Maria", boxName: "Box Central", accountStatus: "ok" });
    if (pathname === "/api/classes") {
      return json(route, [{ name: "CrossFit", time: "07:00", count: 3, capacity: 15 }]);
    }
    if (pathname === "/api/schedules" && method === "GET") return json(route, schedules);
    if (pathname === "/api/schedules" && method === "POST") {
      const body = request.postDataJSON();
      schedules = [
        {
          scheduleId: "s1",
          className: body.className,
          startTime: body.startTime,
          kind: body.kind,
          weekdays: body.weekdays,
          allowWaitingList: body.allowWaitingList,
          active: true,
          finished: false,
          nextClass: "2026-11-02T07:00:00",
          last: null,
        },
      ];
      return json(route, { scheduleId: "s1" }, 201);
    }
    if (pathname === "/api/schedules/s1" && method === "PATCH") {
      schedules = schedules.map((s) => ({ ...s, ...request.postDataJSON() }));
      return json(route, {});
    }
    if (pathname === "/api/schedules/s1" && method === "DELETE") {
      schedules = [];
      return json(route, {});
    }
    if (pathname === "/api/executions") {
      const first = !searchParams.get("cursor");
      return json(route, {
        items: [
          first
            ? { scheduleId: "s1", classDate: "2026-10-20", className: "CrossFit", startTime: "07:00", status: "success", attempts: 1 }
            : { scheduleId: "s1", classDate: "2026-10-13", className: "CrossFit", startTime: "07:00", status: "failed", attempts: 3, error: "full" },
        ],
        cursor: first ? "c1" : null,
      });
    }
    return json(route, { message: "not mocked" }, 500);
  });
}

test("convite, cadastro e agendamento semanal", async ({ page }) => {
  await mockApi(page);

  await page.goto("/convite#tok123");
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  await page.getByLabel("E-mail da Tecnofit").fill("maria@example.com");
  await page.getByLabel("Senha da Tecnofit").fill("segredo");
  const submit = page.getByRole("button", { name: "Criar conta" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Li e concordo com o termo acima.").check();
  const onboarding = page.waitForRequest("**/api/onboarding");
  await submit.click();
  expect((await onboarding).postDataJSON()).toMatchObject({ token: "tok123", email: "maria@example.com" });
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Nenhum agendamento.")).toBeVisible();

  await page.getByRole("link", { name: "Novo" }).click();
  await page.getByRole("button", { name: "Buscar aulas" }).click();
  await page.getByLabel(/07:00 — CrossFit/).check();
  await page.getByLabel("Toda semana").check();
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page).toHaveURL(/\/app$/);
  const card = page.getByRole("article");
  await expect(card.getByRole("heading", { name: "07:00 — CrossFit" })).toBeVisible();
  await expect(card).toContainText("Ativo");

  await card.getByRole("button", { name: "Pausar" }).click();
  await expect(card).toContainText("Pausado");
  await card.getByRole("button", { name: "Retomar" }).click();
  await expect(card).toContainText("Ativo");

  await card.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Nenhum agendamento.")).toBeVisible();
});

test("histórico com carregar mais", async ({ page }) => {
  await mockApi(page);
  await page.goto("/app/historico");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Check-in feito · 1 tentativa")).toBeVisible();
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("Falhou (lotada) · 3 tentativas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
});

test("login com erro genérico e sair", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("maria@example.com");
  await page.getByLabel("Senha da Tecnofit").fill("errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Credenciais inválidas.");

  await page.goto("/app/conta");
  await expect(page.getByRole("heading", { name: "Maria" })).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});
