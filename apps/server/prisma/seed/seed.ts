import {
  Prisma,
  PrismaClient,
  ProductClassification,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { hashPassword } from "../../src/utils/password.js";

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not defined");
  return value;
}

const connectionString = getDatabaseUrl();

const installerBootstrap =
  process.env.BIGBITES_INSTALL_BOOTSTRAP === "CREATE_EMPTY_DATABASE";

if (
  !installerBootstrap &&
  process.env.CONFIRM_MENU_SEED !== "YES_UPDATE_MENU_ONLY"
) {
  throw new Error(
    "Set CONFIRM_MENU_SEED=YES_UPDATE_MENU_ONLY to confirm this menu-only database update.",
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

type MenuProduct = {
  category: string;
  name: string;
  price: number;
  classification: ProductClassification;
  subcategory?: string;
  signature?: boolean;
  variants?: { name: string; price: number }[];
};

const VEG = ProductClassification.VEG;
const NON_VEG = ProductClassification.NON_VEG;
const NOT_APPLICABLE = ProductClassification.NOT_APPLICABLE;

const categories = [
  "Soups",
  "Starters (Veg)",
  "Starters (Non Veg)",
  "Chukka",
  "Kebab",
  "BBQ & Grill",
  "Indian Gravy (Veg)",
  "Indian Gravy (Non Veg)",
  "Naan / Roti",
  "Rice & Noodles (Veg)",
  "Rice & Noodles (Non Veg)",
  "Briyani",
  "Beverages",
  "Shawarma",
  "Big Bites Signature Dish",
];

function items(
  category: string,
  classification: ProductClassification,
  entries: [string, number, boolean?][],
  subcategory?: string,
): MenuProduct[] {
  return entries.map(([name, price, signature]) => ({
    category,
    name,
    price,
    classification,
    ...(subcategory ? { subcategory } : {}),
    ...(signature ? { signature: true } : {}),
  }));
}

function variantProduct(
  category: string,
  name: string,
  classification: ProductClassification,
  variants: { name: string; price: number }[],
  signature = false,
): MenuProduct {
  return {
    category,
    name,
    classification,
    price: variants[0].price,
    variants,
    ...(signature ? { signature: true } : {}),
  };
}

const shawarmaVariants = (prices: [number, number, number, number]) => [
  { name: "Roll", price: prices[0] },
  { name: "SPL Roll", price: prices[1] },
  { name: "Plate", price: prices[2] },
  { name: "SPL Plate", price: prices[3] },
];

const menu: MenuProduct[] = [
  ...items("Soups", VEG, [
    ["Veg Clear Soup", 60],
    ["Sweet Corn Soup", 80],
    ["Hot & Sour Veg Soup", 80],
    ["Noodles Soup", 80],
    ["Manchow Soup", 80],
  ], "Veg Soups"),
  ...items("Soups", NON_VEG, [
    ["Chicken Clear Soup", 80],
    ["Chicken Manchow Soup", 90],
    ["Hot & Sour Chicken Soup", 90],
    ["Chicken Pepper Soup", 90],
    ["Mutton Soup", 100],
    ["Prawn Soup", 100],
  ], "Non Veg Soups"),
  ...items("Starters (Veg)", VEG, [
    ["Paneer 65", 150],
    ["Mushroom 65", 130],
    ["Gobi 65", 130],
    ["Crispy Potato", 130],
    ["Paneer Manchurian", 180],
    ["Chilli Paneer", 180],
    ["Mushroom Manchurian", 150],
    ["Chilli Mushroom", 150],
    ["Gobi Manchurian", 160],
    ["Chilli Gobi", 150],
  ]),
  ...items("Starters (Non Veg)", NON_VEG, [
    ["Chicken 65 (6 Pc)", 160],
    ["Lollipop (Sauce)", 170],
    ["Lollipop (Dry)", 160],
    ["Chilli Chicken", 180],
    ["Chicken Manchurian", 180],
    ["Dragon Chicken", 190],
    ["Honey Chilli Chicken", 180],
    ["Lemon Chicken", 180],
    ["Ginger Chicken", 180],
    ["Garlic Chicken", 180],
    ["Crispy Chicken", 190],
    ["Karam Chicken", 180, true],
    ["Prawn Manchurian", 200],
    ["Fish Manchurian", 200],
    ["Chilli Fish", 200],
    ["Honey Wings", 200, true],
  ]),
  ...items("Chukka", NON_VEG, [
    ["Chicken Pepper Fry", 180],
    ["Mutton Pepper Fry", 250],
    ["Prawn Pepper Fry", 200],
    ["Chicken Chukka", 180],
    ["Mutton Chukka", 250],
  ]),
  ...items("Kebab", NON_VEG, [
    ["Lasuni Kebab", 160],
    ["Kali Mirch Kebab", 170],
    ["Cheese Malai Kebab", 150],
    ["Red Chilli Kebab", 170],
    ["Golden Kebab", 180],
    ["Malai Kebab", 150],
    ["Chicken Tikka", 150],
  ]),
  variantProduct("BBQ & Grill", "Plain BBQ", NON_VEG, [
    { name: "Quarter", price: 130 },
    { name: "Half", price: 250 },
    { name: "Full", price: 460 },
  ]),
  variantProduct("BBQ & Grill", "Pepper BBQ", NON_VEG, [
    { name: "Quarter", price: 140 },
    { name: "Half", price: 260 },
    { name: "Full", price: 470 },
  ]),
  variantProduct("BBQ & Grill", "Grill", NON_VEG, [
    { name: "Half", price: 250 },
    { name: "Full", price: 450 },
  ]),
  ...items("Indian Gravy (Veg)", VEG, [
    ["Paneer Butter Masala", 180],
    ["Paneer Pepper Masala", 170],
    ["Kadai Paneer Masala", 170],
    ["Mushroom Masala", 150],
    ["Alu Gobi Masala", 140],
    ["Green Peas Masala", 140],
    ["Paneer Tikka Masala", 190],
    ["Dall Fry", 100],
    ["Dall Tadka", 130],
  ]),
  ...items("Indian Gravy (Non Veg)", NON_VEG, [
    ["Pepper Chicken Masala", 180],
    ["Diamond Chicken", 220],
    ["Chittinad Chicken Masala", 180],
    ["Kadai Chicken Masala", 190],
    ["Chicken Tikka Masala", 170],
    ["Chicken Kema Masala", 170],
    ["Butter Chicken Masala", 190],
    ["Prawn Masala", 190],
    ["Chittinad Prawn", 180],
    ["Kadai Prawn", 180],
    ["Fish Curry", 200],
    ["Mutton Pepper Masala", 220],
    ["Chittinad Mutton", 230],
    ["Mutton Rogan Josh", 250],
    ["Punjabi Mutton", 260],
  ]),
  ...items("Naan / Roti", VEG, [
    ["Plain Naan", 40],
    ["Butter Naan", 50],
    ["Garlic Naan", 60],
    ["Cheese Naan", 60],
    ["Masala Kulcha", 70],
    ["Plain Kulcha", 50],
    ["Lacha Parrota", 60],
    ["Roti", 20],
    ["Butter Roti", 25],
    ["Vechi Parrota", 30],
    ["Onion Chilli Roti", 30],
  ]),
  ...items("Rice & Noodles (Veg)", VEG, [
    ["Veg Rice", 130],
    ["Gobi Rice", 140],
    ["Mushroom Rice", 140],
    ["Paneer Rice", 150],
    ["Mixed Veg Rice", 170],
  ], "Rice"),
  ...items("Rice & Noodles (Veg)", VEG, [
    ["Veg Noodles", 130],
    ["Gobi Noodles", 140],
    ["Paneer Noodles", 150],
    ["Mushroom Noodles", 140],
    ["Mixed Veg Noodles", 170],
  ], "Noodles"),
  ...items("Rice & Noodles (Non Veg)", NON_VEG, [
    ["Chicken Rice", 140],
    ["Mutton Rice", 180],
    ["Prawn Rice", 180],
    ["Mixed Non Veg Rice", 200],
  ], "Rice"),
  ...items("Rice & Noodles (Non Veg)", NON_VEG, [
    ["Chicken Noodles", 140],
    ["Mutton Noodles", 180],
    ["Prawn Noodles", 180],
    ["Mixed Non Veg Noodles", 200],
  ], "Noodles"),
  ...items("Briyani", NON_VEG, [
    ["Chicken Briyani", 150],
    ["Mutton Briyani", 260],
    ["Prawn Briyani", 240],
    ["Chicken 65 Briyani", 180],
    ["Egg Briyani", 120],
  ]),
  ...items("Briyani", VEG, [["Plain Briyani", 110]]),
  ...items("Beverages", NOT_APPLICABLE, [["Water Bottle", 20]]),
  variantProduct("Shawarma", "Classic Shawarma", NON_VEG, shawarmaVariants([100, 140, 150, 180])),
  variantProduct("Shawarma", "Mexican Shawarma", NON_VEG, shawarmaVariants([110, 140, 160, 180])),
  variantProduct("Shawarma", "Peri Peri Shawarma", NON_VEG, shawarmaVariants([110, 140, 160, 180])),
  variantProduct("Shawarma", "Cheese Shawarma", NON_VEG, shawarmaVariants([110, 140, 160, 180])),
  variantProduct("Shawarma", "Schezwan Shawarma", NON_VEG, shawarmaVariants([110, 140, 160, 180])),
  variantProduct("Shawarma", "Chilli Garlic Shawarma", NON_VEG, shawarmaVariants([110, 140, 160, 180])),
  ...items("Big Bites Signature Dish", NON_VEG, [
    ["Poori Shawarma", 100, true],
    ["Pot Shawarma", 140, true],
    ["Thuku Shawarma", 180, true],
  ]),
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const legacyVariantNames = [
  ...["Plain BBQ", "Pepper BBQ"].flatMap((name) =>
    ["Quarter", "Half", "Full"].flatMap((size) => [
      `${name} - ${size}`,
      `${name} ${size}`,
    ]),
  ),
  "Grill - Half",
  "Grill - Full",
  "Grill Half",
  "Grill Full",
  ...["Classic", "Mexican", "Peri Peri", "Cheese", "Schezwan"].flatMap((name) =>
    ["Roll", "Spl Roll", "Plate", "Spl Plate"].flatMap((size) => [
      `${name} Shawarma - ${size}`,
      `${name} Shawarma ${size}`,
    ]),
  ),
  ...["ChilliGarlic", "Chilli Garlic"].flatMap((name) =>
    ["Roll", "Spl Roll", "Plate", "Spl Plate"].flatMap((size) => [
      `${name} Shawarma - ${size}`,
      `${name} Shawarma ${size}`,
    ]),
  ),
];

type InstallerAccount = {
  name: string;
  username: string;
  password: string;
  role: "ADMIN" | "CASHIER" | "WAITER";
};

type InstallerBootstrapInput = {
  confirmInitialMenu: true;
  accounts: InstallerAccount[];
};

async function readInstallerBootstrapInput(): Promise<InstallerBootstrapInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  let input: unknown;
  try {
    const encoded = Buffer.concat(chunks).toString("ascii").trim();
    input = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Installer setup input was invalid.");
  }

  if (
    !input ||
    typeof input !== "object" ||
    !("confirmInitialMenu" in input) ||
    input.confirmInitialMenu !== true ||
    !("accounts" in input) ||
    !Array.isArray(input.accounts) ||
    input.accounts.length !== 3
  ) {
    throw new Error("Installer setup input was incomplete.");
  }

  const expectedRoles = ["ADMIN", "CASHIER", "WAITER"];
  const usernames = new Set<string>();
  const accounts = input.accounts.map((account, index) => {
    if (!account || typeof account !== "object") {
      throw new Error("Installer account details were invalid.");
    }
    const candidate = account as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const username =
      typeof candidate.username === "string"
        ? candidate.username.trim()
        : "";
    const password =
      typeof candidate.password === "string" ? candidate.password : "";
    const role = candidate.role;
    const normalizedUsername = username.toLocaleLowerCase("en-US");

    if (
      !name ||
      name.length > 100 ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(username) ||
      password.length < 12 ||
      role !== expectedRoles[index] ||
      usernames.has(normalizedUsername)
    ) {
      throw new Error(
        "Each account needs a unique username, name, and password of at least 12 characters.",
      );
    }

    usernames.add(normalizedUsername);
    return {
      name,
      username,
      password,
      role: role as InstallerAccount["role"],
    };
  });

  return { confirmInitialMenu: true, accounts };
}

async function assertDatabaseSafeForInstallerBootstrap(
  tx: Prisma.TransactionClient,
) {
  const unknownTables = await tx.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        '_prisma_migrations',
        'User',
        'RestaurantTable',
        'Category',
        'Product',
        'ProductVariant',
        'Order',
        'RestaurantSettings',
        'OrderItem',
        'Payment'
      )
  `;
  if (unknownTables.length > 0) {
    throw new Error(
      "Installer initialization stopped because the database contains unrecognized tables.",
    );
  }

  const sequences = await tx.$queryRaw<
    {
      table_name: string;
      last_value: bigint | null;
      sequence_exists: boolean;
      can_read_sequence: boolean;
    }[]
  >`
    WITH expected_sequences AS (
      SELECT
        table_name,
        to_regclass(
          pg_get_serial_sequence(
            format('%I.%I', 'public', table_name),
            'id'
          )
        ) AS sequence_oid
      FROM unnest(ARRAY[
        'User',
        'RestaurantTable',
        'Category',
        'Product',
        'ProductVariant',
        'Order',
        'OrderItem',
        'Payment'
      ]::text[]) AS tables(table_name)
    )
    SELECT
      expected.table_name,
      sequences.last_value,
      (sequence_class.oid IS NOT NULL) AS sequence_exists,
      CASE
        WHEN sequence_class.oid IS NULL THEN false
        ELSE has_sequence_privilege(current_user, sequence_class.oid, 'SELECT')
      END AS can_read_sequence
    FROM expected_sequences AS expected
    LEFT JOIN pg_class AS sequence_class
      ON sequence_class.oid = expected.sequence_oid
    LEFT JOIN pg_namespace AS sequence_schema
      ON sequence_schema.oid = sequence_class.relnamespace
    LEFT JOIN pg_sequences AS sequences
      ON sequences.schemaname = sequence_schema.nspname
      AND sequences.sequencename = sequence_class.relname
  `;
  const hasUnexpectedSequenceUse =
    sequences.length !== 9 ||
    sequences.some(
      ({ table_name, last_value, sequence_exists, can_read_sequence }) =>
        !sequence_exists ||
        !can_read_sequence ||
        (table_name === "RestaurantTable"
          ? last_value !== 1n
          : last_value !== null),
    );

  const [
    userCount,
    categoryCount,
    productCount,
    variantCount,
    orderCount,
    orderItemCount,
    paymentCount,
    tables,
    settings,
  ] = await Promise.all([
    tx.user.count(),
    tx.category.count(),
    tx.product.count(),
    tx.productVariant.count(),
    tx.order.count(),
    tx.orderItem.count(),
    tx.payment.count(),
    tx.restaurantTable.findMany({
      select: { number: true, isParcel: true, status: true },
    }),
    tx.restaurantSettings.findMany({
      select: {
        id: true,
        gstRate: true,
        gstEnabled: true,
        orderReportsPath: true,
        restaurantAddress: true,
        fssaiEnabled: true,
        fssaiNumber: true,
        gstinEnabled: true,
        gstinNumber: true,
      },
    }),
  ]);

  const hasBusinessRows = [
    userCount,
    categoryCount,
    productCount,
    variantCount,
    orderCount,
    orderItemCount,
    paymentCount,
  ].some((count) => count !== 0);
  const hasNonDefaultTables =
    tables.length > 1 ||
    (tables.length === 1 &&
      (tables[0].number !== 0 ||
        !tables[0].isParcel ||
        tables[0].status !== "AVAILABLE"));
  const hasNonDefaultSettings =
    settings.length > 1 ||
    (settings.length === 1 &&
      (settings[0].id !== 1 ||
        Number(settings[0].gstRate) !== 5 ||
        !settings[0].gstEnabled ||
        settings[0].orderReportsPath !== "" ||
        settings[0].restaurantAddress !== "" ||
        settings[0].fssaiEnabled ||
        settings[0].fssaiNumber !== "" ||
        settings[0].gstinEnabled ||
        settings[0].gstinNumber !== ""));

  if (
    hasBusinessRows ||
    hasNonDefaultTables ||
    hasNonDefaultSettings ||
    hasUnexpectedSequenceUse
  ) {
    throw new Error(
      "Installer initialization stopped: the database is not empty. Existing users, menu, orders, payments, tables, or settings were not changed.",
    );
  }
}

async function createInitialMenu(tx: Prisma.TransactionClient) {
  const categoryIds = new Map<string, number>();
  for (const [index, name] of categories.entries()) {
    const category = await tx.category.create({
      data: { name, sortOrder: index },
    });
    categoryIds.set(name, category.id);
  }

  let createdVariants = 0;
  for (const product of menu) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error("Initial menu data was incomplete.");

    const classification = product.classification;
    const savedProduct = await tx.product.create({
      data: {
        slug: `${slugify(product.category)}-${slugify(product.name)}`,
        name: product.name,
        price: product.price,
        categoryId,
        classification,
        isVegetarian: classification === VEG,
        subcategory: product.subcategory ?? null,
        isSignature: product.signature ?? false,
      },
    });

    for (const variant of product.variants ?? []) {
      await tx.productVariant.create({
        data: {
          productId: savedProduct.id,
          name: variant.name,
          price: variant.price,
        },
      });
      createdVariants += 1;
    }
  }

  return {
    categories: categories.length,
    products: menu.length,
    variants: createdVariants,
  };
}

async function createInitialAccounts(
  tx: Prisma.TransactionClient,
  accounts: InstallerAccount[],
) {
  const hashedAccounts = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      password: await hashPassword(account.password),
    })),
  );

  for (const account of hashedAccounts) {
    await tx.user.create({
      data: {
        name: account.name,
        username: account.username,
        password: account.password,
        role: account.role,
      },
    });
  }

  return hashedAccounts.length;
}

async function initializeEmptyDatabase() {
  const target = new URL(connectionString);
  const schemaParameters = target.searchParams.getAll("schema");
  if (
    target.protocol !== "postgresql:" ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(target.hostname) ||
    target.port !== "5432" ||
    decodeURIComponent(target.username) !== "bigbites_app" ||
    !target.password ||
    decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "bigbites" ||
    target.search !== "?schema=public" ||
    schemaParameters.length !== 1 ||
    schemaParameters[0] !== "public"
  ) {
    throw new Error(
      "Installer initialization requires the exact local bigbites database, bigbites_app role, port 5432, and public schema; the configured database was not contacted.",
    );
  }

  const input = await readInstallerBootstrapInput();

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(804217531)`;
      await assertDatabaseSafeForInstallerBootstrap(tx);

      const menuResult = await createInitialMenu(tx);
      const accountCount = await createInitialAccounts(tx, input.accounts);

      return {
        ...menuResult,
        accounts: accountCount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  console.log(
    `Initialized an empty local database with ${result.categories} categories, ${result.products} products, ${result.variants} variants, and ${result.accounts} accounts.`,
  );
}

async function main() {
  if (installerBootstrap) {
    await initializeEmptyDatabase();
    return;
  }

  const database = await prisma.$queryRaw<{ database: string }[]>`
    SELECT current_database() AS database
  `;
  const target = new URL(connectionString);
  console.log(
    `Updating menu only in ${target.hostname}/${database[0].database}.`,
  );

  const categoryIds = new Map<string, number>();
  for (const [index, name] of categories.entries()) {
    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    const category = existing
      ? await prisma.category.update({
          where: { id: existing.id },
          data: { name, sortOrder: index },
        })
      : await prisma.category.create({
          data: { name, sortOrder: index },
        });
    categoryIds.set(name, category.id);
  }

  let createdProducts = 0;
  let updatedProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;

  for (const product of menu) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Missing category ${product.category}`);

    const slug = `${slugify(product.category)}-${slugify(product.name)}`;
    const bySlug = await prisma.product.findUnique({ where: { slug } });
    const matchingProducts = bySlug
      ? [bySlug]
      : await prisma.product.findMany({
          where: { name: product.name },
          orderBy: [{ isActive: "desc" }, { id: "asc" }],
        });
    const existing = matchingProducts[0];
    const classification = product.classification;
    const data = {
      slug,
      name: product.name,
      price: product.price,
      categoryId,
      classification,
      isVegetarian: classification === VEG,
      subcategory: product.subcategory ?? null,
      isSignature: product.signature ?? false,
      isActive: true,
    };

    const savedProduct = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.product.create({
          data,
        });
    if (existing) updatedProducts += 1;
    else createdProducts += 1;

    const duplicateIds = matchingProducts
      .slice(1)
      .map((duplicate) => duplicate.id);
    if (duplicateIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: duplicateIds } },
        data: { isActive: false },
      });
    }

    const variants = product.variants ?? [];
    for (const variant of variants) {
      const existingVariant = await prisma.productVariant.findUnique({
        where: {
          productId_name: { productId: savedProduct.id, name: variant.name },
        },
        select: { id: true },
      });
      await prisma.productVariant.upsert({
        where: {
          productId_name: { productId: savedProduct.id, name: variant.name },
        },
        update: { price: variant.price, isActive: true },
        create: {
          productId: savedProduct.id,
          name: variant.name,
          price: variant.price,
        },
      });
      if (existingVariant) updatedVariants += 1;
      else createdVariants += 1;
    }
    await prisma.productVariant.updateMany({
      where: {
        productId: savedProduct.id,
        ...(variants.length
          ? { name: { notIn: variants.map((variant) => variant.name) } }
          : {}),
      },
      data: { isActive: false },
    });
  }

  await prisma.product.updateMany({
    where: { name: { in: legacyVariantNames } },
    data: { isActive: false },
  });

  const activeMenu = await prisma.product.findMany({
    where: { slug: { in: menu.map((product) => `${slugify(product.category)}-${slugify(product.name)}`) }, isActive: true },
    include: { category: true, variants: { where: { isActive: true } } },
  });
  const activeVariantCount = activeMenu.reduce(
    (count, product) => count + product.variants.length,
    0,
  );
  console.log(
    JSON.stringify({
      categoriesPresent: categoryIds.size,
      menuProductsPresent: activeMenu.length,
      createdProducts,
      updatedProducts,
      activeVariantsPresent: activeVariantCount,
      createdVariants,
      updatedVariants,
    }),
  );
}

main()
  .catch((error) => {
    console.error("Menu-only seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
