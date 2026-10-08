import { PrismaClient, UserRole, TableStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../../src/utils/password.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  const seedPasswords = {
    admin: process.env.SEED_ADMIN_PASSWORD,
    cashier: process.env.SEED_CASHIER_PASSWORD,
    waiter: process.env.SEED_WAITER_PASSWORD,
  };
  if (
    !seedPasswords.admin?.trim() ||
    !seedPasswords.cashier?.trim() ||
    !seedPasswords.waiter?.trim()
  ) {
    throw new Error(
      "SEED_ADMIN_PASSWORD, SEED_CASHIER_PASSWORD, and SEED_WAITER_PASSWORD are required",
    );
  }

  console.log("🌱 Starting database seed...");

  // -----------------------------
  // 1. Create 8 restaurant tables
  // -----------------------------
  for (let number = 1; number <= 8; number++) {
    await prisma.restaurantTable.upsert({
      where: { number },
      update: {
        status: TableStatus.AVAILABLE,
      },
      create: {
        number,
        status: TableStatus.AVAILABLE,
      },
    });
  }

  await prisma.restaurantTable.upsert({
    where: { number: 0 },
    update: { isParcel: true, status: TableStatus.AVAILABLE },
    create: { number: 0, isParcel: true, status: TableStatus.AVAILABLE },
  });

  console.log("✅ 8 tables and Parcel option created");

  // -----------------------------
  // 2. Create categories
  // -----------------------------
  const categories = [
    "Biryani",
    "Rice",
    "Starters",
    "Bread",
    "Drinks",
  ];

  const categoryRecords: Record<string, number> = {};

  for (const name of categories) {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });

    categoryRecords[name] = category.id;
  }

  console.log("✅ Categories created");

  // -----------------------------
  // 3. Create food products
  // -----------------------------
  const products = [
    {
      name: "Chicken Biryani",
      price: 180,
      stock: 100,
      category: "Biryani",
    },
    {
      name: "Mutton Biryani",
      price: 240,
      stock: 50,
      category: "Biryani",
    },
    {
      name: "Chicken Rice",
      price: 140,
      stock: 100,
      category: "Rice",
    },
    {
      name: "Veg Fried Rice",
      price: 110,
      stock: 80,
      category: "Rice",
    },
    {
      name: "Chicken 65",
      price: 160,
      stock: 75,
      category: "Starters",
    },
    {
      name: "Paneer 65",
      price: 140,
      stock: 60,
      category: "Starters",
    },
    {
      name: "Parotta",
      price: 25,
      stock: 100,
      category: "Bread",
    },
    {
      name: "Butter Naan",
      price: 45,
      stock: 80,
      category: "Bread",
    },
    {
      name: "Coke",
      price: 40,
      stock: 100,
      category: "Drinks",
    },
    {
      name: "Fresh Lime",
      price: 50,
      stock: 100,
      category: "Drinks",
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: {
        id: (
          await prisma.product.findFirst({
            where: { name: product.name },
            select: { id: true },
          })
        )?.id ?? -1,
      },
      update: {
        price: product.price,
        stock: product.stock,
        isActive: true,
        categoryId: categoryRecords[product.category],
      },
      create: {
        name: product.name,
        price: product.price,
        stock: product.stock,
        isActive: true,
        categoryId: categoryRecords[product.category],
      },
    });
  }

  console.log("✅ Food products created");

  // -----------------------------
  // 4. Create demo users
  // -----------------------------
  const users = [
    {
      name: "Admin User",
      username: "admin",
      password: seedPasswords.admin,
      role: UserRole.ADMIN,
    },
    {
      name: "Cashier User",
      username: "cashier",
      password: seedPasswords.cashier,
      role: UserRole.CASHIER,
    },
    {
      name: "Waiter User",
      username: "waiter",
      password: seedPasswords.waiter,
      role: UserRole.WAITER,
    },
  ];

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: {
        username: user.username,
      },
      update: {
        name: user.name,
        password: passwordHash,
        role: user.role,
      },
      create: {
        name: user.name,
        username: user.username,
        password: passwordHash,
        role: user.role,
      },
    });
  }

  console.log("✅ Demo users created");

  console.log("");
  console.log("🎉 Database seed completed successfully!");
  console.log("");
  console.log("Seeded admin, cashier, and waiter accounts using configured passwords.");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });