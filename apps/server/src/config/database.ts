import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const localDeployment =
  process.env.BIGBITES_DEPLOYMENT_MODE === "local" ||
  (existsSync(path.resolve(process.cwd(), ".env")) &&
    process.env.RENDER !== "true");

if (localDeployment || process.env.NODE_ENV !== "production") {
  const databaseUrl = new URL(connectionString);
  const databaseHost = databaseUrl.hostname.toLowerCase();
  if (
    databaseUrl.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)
  ) {
    throw new Error(
      "Local POS server processes must use a local PostgreSQL DATABASE_URL.",
    );
  }
}

const adapter = new PrismaPg({
  connectionString,
});

export const prisma = new PrismaClient({
  adapter,
});