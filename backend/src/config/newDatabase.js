import { readFileSync } from "node:fs";

const project = "gobvtqiwtgmbjkxtaiuq";
const pooler = "aws-1-ap-northeast-1.pooler.supabase.com";

export function newDatabaseOptions(env = process.env) {
  if (!env.OPSPULSE_NEW_DATABASE_URL) throw new Error("OPSPULSE_NEW_DATABASE_URL is required");
  let url;
  try {
    url = new URL(env.OPSPULSE_NEW_DATABASE_URL);
  } catch {
    throw new Error("Invalid OPSPULSE_NEW_DATABASE_URL");
  }
  const validHost = (
    url.hostname === pooler && new RegExp(`^[a-zA-Z0-9_]+\\.${project}$`).test(url.username)
  ) || url.hostname === `db.${project}.supabase.co`;
  if (!validHost || !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.port !== "5432" || url.pathname !== "/postgres" || !url.password || url.hash ||
      [...url.searchParams].some(([key, value]) => key !== "sslmode" || !["require", "verify-full"].includes(value))) {
    throw new Error("New database URL must identify the OpsPulse Supabase project over port 5432");
  }

  if (!env.OPSPULSE_DATABASE_CA_FILE) throw new Error("OPSPULSE_DATABASE_CA_FILE is required for verified TLS");
  const ca = readFileSync(env.OPSPULSE_DATABASE_CA_FILE);
  url.search = "";
  return {
    connectionString: url.href,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 8000,
  };
}
