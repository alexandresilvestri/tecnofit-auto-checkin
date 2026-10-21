const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function fakeJwt(payload: object): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.fake-signature`;
}
