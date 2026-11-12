const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  console.log(await p.$queryRawUnsafe("SELECT current_database() AS db, current_user AS usr"));
  console.log(await p.$queryRawUnsafe("SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'Category' ORDER BY grantee, privilege_type"));
})().catch(e => console.log("Check failed:", e.message)).finally(() => p.$disconnect());
