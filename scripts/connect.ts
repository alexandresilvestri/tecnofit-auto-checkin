import { randomUUID } from "node:crypto";
import { encryptToken } from "@checkin/core/crypto/token";
import { getMe, login } from "@checkin/core/tecnofit/client";
import { loadEnv } from "./env.js";

const email = process.env.TECNOFIT_EMAIL;
const password = process.env.TECNOFIT_PASSWORD;
if (!email || !password) {
  console.error("Set TECNOFIT_EMAIL and TECNOFIT_PASSWORD");
  process.exit(1);
}

const env = await loadEnv();
const { entities, kms } = env;

const session = await login(email, password);
const me = await getMe(session.token);
const boxName = me.companies.find((c) => c.id === session.empresaId)?.name ?? String(session.empresaId);

const existing = (await entities.profile.query.byEmail({ tecnofitEmail: email }).go()).data[0];
const userId = existing?.userId ?? `u_${randomUUID()}`;
if (!existing) {
  await entities.profile
    .create({
      userId,
      name: me.name,
      tecnofitEmail: email,
      tecnofitUserId: session.userId,
      status: "active",
      createdAt: new Date().toISOString(),
    })
    .go();
}
await entities.account
  .put({
    userId,
    empresaId: String(session.empresaId),
    tokenEnc: await encryptToken(kms, env.keyId, userId, session.token),
    tokenExp: session.exp,
    boxName,
    status: "ok",
  })
  .go();

console.log(userId);
