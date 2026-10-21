export const MOTO_ENDPOINT = process.env.MOTO_ENDPOINT ?? "http://localhost:5000";

export const awsConfig = {
  endpoint: MOTO_ENDPOINT,
  region: "sa-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

export async function resetMoto(): Promise<void> {
  await fetch(`${MOTO_ENDPOINT}/moto-api/reset`, { method: "POST" });
}
