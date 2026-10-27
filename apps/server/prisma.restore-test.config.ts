import { defineConfig } from "prisma/config";

const raw = process.env.BIGBITES_TEST_DATABASE_URL;
if (!raw) throw new Error("BIGBITES_TEST_DATABASE_URL is required");

const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "5432" || url.pathname !== "/bigbites_restore_test") {
  throw new Error("SAFETY STOP: Only 127.0.0.1:5432/bigbites_restore_test is allowed");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: raw }
});
