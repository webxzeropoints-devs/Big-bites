import { PrismaClient, ProductClassification } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

if (process.env.CONFIRM_MENU_SEED !== "YES_UPDATE_MENU_ONLY") {
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

async function main() {
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
          data: { ...data, stock: 0 },
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
      preservedStock: true,
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
