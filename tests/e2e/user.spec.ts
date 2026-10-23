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
          date: body.date,
          active: true,
          finished: false,
          nextClass: "2026-11-02 07:00",
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

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Agendamentos" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Novo" }).click();
  await page.getByLabel("Toda semana").check();
  await page.getByLabel("Seg").check();
  await page.getByRole("button", { name: "Buscar aulas" }).click();
  await expect(page.getByRole("group", { name: "Aulas em seg" })).toBeVisible();
  await page.getByLabel(/07:00 — CrossFit/).check();
  await expect(page.getByText(/^Próximo check-in: dom \d{2}\/\d{2} às 19:00$/)).toBeVisible();
  const created = page.waitForRequest((r) => r.url().endsWith("/api/schedules") && r.method() === "POST");
  await page.getByRole("button", { name: "Agendar toda semana" }).click();
  expect((await created).postDataJSON()).toMatchObject({ className: "CrossFit", startTime: "07:00", kind: "weekly", weekdays: [1] });

  await expect(page).toHaveURL(/\/app$/);
  const card = page.getByRole("article");
  await expect(card.getByRole("heading", { name: "07:00 — CrossFit" })).toBeVisible();
  await expect(card).toContainText("Toda semana");
  await expect(card).toContainText("seg");
  await expect(card).toContainText("dom 01/11 às 19:00");
  await expect(card).toContainText("Ativo");

  await card.getByRole("button", { name: "Pausar" }).click();
  await expect(card).toContainText("Pausado");
  await card.getByRole("button", { name: "Retomar" }).click();
  await expect(card).toContainText("Ativo");

  await card.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Nenhum agendamento.")).toBeVisible();
});

test("agendamento de uma vez com resumo", async ({ page }) => {
  await mockApi(page);
  await page.goto("/app/novo");
  await expect(page.getByLabel("Uma vez")).toBeChecked();

  await page.getByLabel("Data").fill("2020-01-06");
  await page.getByRole("button", { name: "Buscar aulas" }).click();
  await page.getByLabel(/07:00 — CrossFit/).check();
  await expect(page.getByText("O check-in desta aula já foi liberado. Faça pelo app da Tecnofit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agendar uma vez" })).toBeDisabled();

  await page.getByLabel("Data").fill("2099-01-05");
  await page.getByRole("button", { name: "Buscar aulas" }).click();
  await page.getByLabel(/07:00 — CrossFit/).check();
  await expect(page.getByText("CrossFit, seg 05/01, 07:00")).toBeVisible();
  await expect(page.getByText("Check-in: dom 04/01 às 19:00")).toBeVisible();
  const created = page.waitForRequest((r) => r.url().endsWith("/api/schedules") && r.method() === "POST");
  await page.getByRole("button", { name: "Agendar uma vez" }).click();
  expect((await created).postDataJSON()).toEqual({ className: "CrossFit", startTime: "07:00", date: "2099-01-05", kind: "once" });

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("article")).toContainText("Uma vez");
  await expect(page.getByRole("article")).toContainText("05/01/2099");
});

test("tema pelo menu e espera ao buscar aulas", async ({ page }) => {
  await mockApi(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/classes**", async (route) => {
    await held;
    await json(route, [{ name: "CrossFit", time: "07:00", count: 3, capacity: 15 }]);
  });
  await page.emulateMedia({ colorScheme: "dark" });

  await page.goto("/app");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("link", { name: "Novo" }).click();
  await page.getByRole("button", { name: "Buscar aulas" }).click();
  await expect(page.getByRole("status")).toContainText("Buscando aulas");
  release();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByLabel(/07:00 — CrossFit/)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Check-in automático" })).toBeVisible();
});
