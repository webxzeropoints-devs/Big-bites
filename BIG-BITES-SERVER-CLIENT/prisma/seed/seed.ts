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
  // 2. Clear order history and bill data to keep the menu update controlled
  // -----------------------------
  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({});
    await tx.order.deleteMany({});
    await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('"Order"', 'id'), 1, false)`;
  });

  console.log("✅ Existing orders and bill history reset");

  // -----------------------------
  // 3. Create categories
  // -----------------------------
  const categories = [
    "SOUPS",
    "STARTERS (VEG)",
    "STARTERS (NON VEG)",
    "CHUKKA",
    "KEBAB",
    "BBQ & GRILL",
    "INDIAN GRAVY (VEG)",
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

  const desiredProductNames = new Set<string>();

  // -----------------------------
  // 4. Create food products
  // -----------------------------
  const products = [
    { name: "Veg Clear Soup", price: 60, category: "SOUPS" },
    { name: "Sweet Corn Soup", price: 80, category: "SOUPS" },
    { name: "Hot & Sour Veg Soup", price: 80, category: "SOUPS" },
    { name: "Noodles Soup", price: 80, category: "SOUPS" },
    { name: "Manchow Soup", price: 80, category: "SOUPS" },
    { name: "Chicken Clear Soup", price: 80, category: "SOUPS" },
    { name: "Chicken Manchow Soup", price: 90, category: "SOUPS" },
    { name: "Hot & Sour Chicken Soup", price: 90, category: "SOUPS" },
    { name: "Chicken Pepper Soup", price: 90, category: "SOUPS" },
    { name: "Mutton Soup", price: 100, category: "SOUPS" },
    { name: "Prawn Soup", price: 100, category: "SOUPS" },
    { name: "Paneer 65", price: 150, category: "STARTERS (VEG)" },
    { name: "Mushroom 65", price: 130, category: "STARTERS (VEG)" },
    { name: "Gobi 65", price: 130, category: "STARTERS (VEG)" },
    { name: "Crispy Potato", price: 130, category: "STARTERS (VEG)" },
    { name: "Paneer Manchurian", price: 180, category: "STARTERS (VEG)" },
    { name: "Chilli Paneer", price: 180, category: "STARTERS (VEG)" },
    { name: "Mushroom Manchurian", price: 150, category: "STARTERS (VEG)" },
    { name: "Chilli Mushroom", price: 150, category: "STARTERS (VEG)" },
    { name: "Gobi Manchurian", price: 160, category: "STARTERS (VEG)" },
    { name: "Chilli Gobi", price: 150, category: "STARTERS (VEG)" },
    { name: "Chicken 65 (6 Pc)", price: 160, category: "STARTERS (NON VEG)" },
    { name: "Lollipop (Sauce)", price: 170, category: "STARTERS (NON VEG)" },
    { name: "Lollipop (Dry)", price: 160, category: "STARTERS (NON VEG)" },
    { name: "Chilli Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Chicken Manchurian", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Dragon Chicken", price: 190, category: "STARTERS (NON VEG)" },
    { name: "Honey Chilli Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Lemon Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Ginger Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Garlic Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Crispy Chicken", price: 190, category: "STARTERS (NON VEG)" },
    { name: "Karam Chicken", price: 180, category: "STARTERS (NON VEG)" },
    { name: "Prawn Manchurian", price: 200, category: "STARTERS (NON VEG)" },
    { name: "Fish Manchurian", price: 200, category: "STARTERS (NON VEG)" },
    { name: "Chilli Fish", price: 200, category: "STARTERS (NON VEG)" },
    { name: "Honey Wings", price: 200, category: "STARTERS (NON VEG)" },
    { name: "Chicken Pepper Fry", price: 180, category: "CHUKKA" },
    { name: "Mutton Pepper Fry", price: 250, category: "CHUKKA" },
    { name: "Prawn Pepper Fry", price: 200, category: "CHUKKA" },
    { name: "Chicken Chukka", price: 180, category: "CHUKKA" },
    { name: "Mutton Chukka", price: 250, category: "CHUKKA" },
    { name: "Lasuni Kebab", price: 160, category: "KEBAB" },
    { name: "Kali Mirch Kebab", price: 170, category: "KEBAB" },
    { name: "Cheese Malai Kebab", price: 150, category: "KEBAB" },
    { name: "Red Chilli Kebab", price: 170, category: "KEBAB" },
    { name: "Golden Kebab", price: 180, category: "KEBAB" },
    { name: "Malai Kebab", price: 150, category: "KEBAB" },
    { name: "Chicken Tikka", price: 150, category: "KEBAB" },
    { name: "Plain BBQ Quarter", price: 130, category: "BBQ & GRILL" },
    { name: "Plain BBQ Half", price: 250, category: "BBQ & GRILL" },
    { name: "Plain BBQ Full", price: 460, category: "BBQ & GRILL" },
    { name: "Pepper BBQ Quarter", price: 140, category: "BBQ & GRILL" },
    { name: "Pepper BBQ Half", price: 260, category: "BBQ & GRILL" },
    { name: "Pepper BBQ Full", price: 470, category: "BBQ & GRILL" },
    { name: "Grill Half", price: 250, category: "BBQ & GRILL" },
    { name: "Grill Full", price: 450, category: "BBQ & GRILL" },
    { name: "Paneer Butter Masala", price: 180, category: "INDIAN GRAVY (VEG)" },
    { name: "Paneer Pepper Masala", price: 170, category: "INDIAN GRAVY (VEG)" },
    { name: "Kadai Paneer Masala", price: 170, category: "INDIAN GRAVY (VEG)" },
    { name: "Mushroom Masala", price: 150, category: "INDIAN GRAVY (VEG)" },
    { name: "Alu Gobi Masala", price: 140, category: "INDIAN GRAVY (VEG)" },
    { name: "Green Peas Masala", price: 140, category: "INDIAN GRAVY (VEG)" },
    { name: "Paneer Tikka Masala", price: 190, category: "INDIAN GRAVY (VEG)" },
    { name: "Dall Fry", price: 100, category: "INDIAN GRAVY (VEG)" },
  ];

  for (const product of products) {
    desiredProductNames.add(product.name);

    const existing = await prisma.product.findFirst({
      where: { name: product.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          price: product.price,          isActive: true,
          categoryId: categoryRecords[product.category],
        },
      });
      continue;
    }

    await prisma.product.create({
      data: {
        name: product.name,
        price: product.price,        isActive: true,
        categoryId: categoryRecords[product.category],
      },
    });
  }

  await prisma.product.deleteMany({
    where: {
      name: {
        notIn: [...desiredProductNames],
      },
    },
  });

  await prisma.category.deleteMany({
    where: {
      name: {
        notIn: categories,
      },
    },
  });

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