import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path:
      process.env.BIGBITES_LOCAL_CLIENT_MIGRATIONS === "1"
        ? "prisma/client-migrations"
        : "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});