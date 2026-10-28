import { Router } from "express";
import path from "node:path";
import { Prisma, ProductClassification } from "@prisma/client";
import { getComboDefinition } from "../catalog/comboCatalog.js";
import { prisma } from "../config/database.js";
import { requireRoles } from "../middleware/auth.js";
import { calculateOrderAmounts, sumOrderAmounts } from "../utils/financial.js";
import {
  toDecimalString,
  toMinorUnits,
  toRateBasisPoints,
} from "../utils/currency.js";
import { hashPassword } from "../utils/password.js";
import { restoreOrderStock } from "../utils/inventory.js";
import {
  exportAllOrderReports,
  exportMonthlyOrderReport,
  getOrderReportSummary,
} from "../utils/orderReports.js";
import {
  lockOrderSequence,
  resetOrderSequenceIfEmpty,
} from "../utils/orderSequence.js";

const router = Router();
const admin = requireRoles("ADMIN");
const safeUser = { id: true, name: true, username: true, role: true, createdAt: true, updatedAt: true };
const id = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const slugify = (value: string) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PRODUCTION_MENU_API = "https://big-bites-server.onrender.com";
const PRODUCTION_MENU_TIMEOUT_MS = 20_000;

type ProductionCategory = {
  id: number;
  name: string;
  sortOrder: number;
};

type ProductionVariant = {
  name: string;
  price: string;
};

type ProductionComboItem = {
  name: string;
  quantity: number;
};

type ProductionProduct = {
  slug: string;
  name: string;
  description: string;
  price: string;
  isVegetarian: boolean;
  classification: ProductClassification;
  subcategory: string | null;
  isSignature: boolean;
  categoryId: number;
  variants: ProductionVariant[];
  comboItems: ProductionComboItem[] | null;
};

function usesInstalledLocalDatabase() {
  try {
    const target = new URL(process.env.DATABASE_URL ?? "");
    const isInstalledDatabase =
      target.protocol === "postgresql:" &&
      target.hostname === "127.0.0.1" &&
      target.port === "5432" &&
      target.pathname === "/bigbites" &&
      target.searchParams.get("schema") === "public";
    const isIsolatedTestDatabase =
      process.env.NODE_ENV === "test" &&
      target.protocol === "postgresql:" &&
      ["127.0.0.1", "localhost", "::1"].includes(target.hostname) &&
      target.port !== "5432" &&
      /^\/bigbites_test_[a-z0-9_]+$/i.test(target.pathname) &&
      target.searchParams.get("schema") === "public";
    return isInstalledDatabase || isIsolatedTestDatabase;
  } catch {
    return false;
  }
}

async function getMissingCatalogSchemaColumns() {
  const columns = await prisma.$queryRaw<
    { tableName: string; columnName: string }[]
  >`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('Category', 'Product', 'ProductVariant')
  `;
  const available = new Set(
    columns.map(({ tableName, columnName }) => `${tableName}.${columnName}`),
  );
  const required: Record<string, string[]> = {
    Category: ["id", "name", "sortOrder"],
    Product: [
      "id",
      "slug",
      "name",
      "description",
      "price",
      "isVegetarian",
      "classification",
      "subcategory",
      "isSignature",
      "isActive",
      "categoryId",
      "comboItems",
    ],
    ProductVariant: ["id", "name", "price", "isActive", "productId"],
  };
  return Object.entries(required).flatMap(([tableName, columnNames]) =>
    columnNames
      .filter((columnName) => !available.has(`${tableName}.${columnName}`))
      .map((columnName) => `${tableName}.${columnName}`),
  );
}

async function fetchProductionMenu() {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PRODUCTION_MENU_TIMEOUT_MS,
  );

  try {
    const [categoriesResponse, productsResponse] = await Promise.all([
      fetch(`${PRODUCTION_MENU_API}/api/products/categories`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
      fetch(`${PRODUCTION_MENU_API}/api/products`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
    ]);

    if (!categoriesResponse.ok || !productsResponse.ok) {
      const failedStatus = !categoriesResponse.ok
        ? categoriesResponse.status
        : productsResponse.status;
      throw new Error(`Production menu request failed (HTTP ${failedStatus})`);
    }

    const [categories, products] = await Promise.all([
      categoriesResponse.json(),
      productsResponse.json(),
    ]);
    if (!Array.isArray(categories) || !Array.isArray(products)) {
      throw new Error("Production menu response must contain category and product lists");
    }

    const categoriesById = new Map<number, ProductionCategory>();
    const categoriesByName = new Set<string>();
    for (const value of categories as unknown[]) {
      if (!value || typeof value !== "object") {
        throw new Error("Production menu contains an invalid category");
      }
      const category = value as Record<string, unknown>;
      const categoryId = id(category.id);
      const name = text(category.name);
      const sortOrder = Number(category.sortOrder ?? 0);
      if (
        !categoryId ||
        !name ||
        !Number.isInteger(sortOrder) ||
        categoriesById.has(categoryId) ||
        categoriesByName.has(name)
      ) {
        throw new Error("Production menu contains an invalid or duplicate category");
      }
      categoriesById.set(categoryId, { id: categoryId, name, sortOrder });
      categoriesByName.add(name);
    }

    const validClassifications = Object.values(ProductClassification);
    const productsBySlug = new Set<string>();
    const normalizedProducts: (ProductionProduct & { variants: ProductionVariant[] })[] = [];
    for (const value of products as unknown[]) {
      if (!value || typeof value !== "object") {
        throw new Error("Production menu contains an invalid product");
      }
      const product = value as Record<string, unknown>;
      const slug = text(product.slug);
      const name = text(product.name);
      const categoryId = id(product.categoryId);
      const category = categoryId ? categoriesById.get(categoryId) : undefined;
      const categoryValue = product.category;
      const nestedCategory =
        categoryValue && typeof categoryValue === "object"
          ? (categoryValue as Record<string, unknown>)
          : undefined;
      const classification = product.classification;
      if (
        !slug ||
        !name ||
        !category ||
        !nestedCategory ||
        id(nestedCategory.id) !== category.id ||
        text(nestedCategory.name) !== category.name ||
        productsBySlug.has(slug) ||
        typeof product.price !== "number" && typeof product.price !== "string" ||
        typeof product.isVegetarian !== "boolean" ||
        !validClassifications.includes(classification as ProductClassification) ||
        product.isActive !== true ||
        !Array.isArray(product.variants)
      ) {
        throw new Error("Production menu contains an incomplete, inactive, or duplicate product");
      }

      const price = toDecimalString(toMinorUnits(product.price, `Price for ${name}`));
      const variants: ProductionVariant[] = [];
      const variantNames = new Set<string>();
      for (const value of product.variants as unknown[]) {
        if (!value || typeof value !== "object") {
          throw new Error(`Production menu contains an invalid variant for ${name}`);
        }
        const variant = value as Record<string, unknown>;
        const variantName = text(variant.name);
        if (
          !variantName ||
          variantNames.has(variantName.toLocaleLowerCase()) ||
          (typeof variant.price !== "number" && typeof variant.price !== "string")
        ) {
          throw new Error(`Production menu contains an invalid variant for ${name}`);
        }
        variantNames.add(variantName.toLocaleLowerCase());
        variants.push({
          name: variantName,
          price: toDecimalString(
            toMinorUnits(variant.price, `Price for ${variantName}`),
          ),
        });
      }

      const subcategory =
        product.subcategory == null ? null : text(product.subcategory);
      if (product.subcategory != null && !subcategory) {
        throw new Error(`Production menu contains an invalid subcategory for ${name}`);
      }
      let comboItems: ProductionComboItem[] | null = null;
      if (product.comboItems != null) {
        if (!Array.isArray(product.comboItems) || product.comboItems.length === 0) {
          throw new Error(`Production menu contains invalid combo items for ${name}`);
        }
        const comboItemNames = new Set<string>();
        comboItems = product.comboItems.map((value) => {
          if (!value || typeof value !== "object") {
            throw new Error(`Production menu contains invalid combo items for ${name}`);
          }
          const item = value as Record<string, unknown>;
          const itemName = text(item.name);
          const quantity = Number(item.quantity);
          if (
            !itemName ||
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            comboItemNames.has(itemName.toLocaleLowerCase())
          ) {
            throw new Error(`Production menu contains invalid combo items for ${name}`);
          }
          comboItemNames.add(itemName.toLocaleLowerCase());
          return { name: itemName, quantity };
        });
      }
      productsBySlug.add(slug);
      normalizedProducts.push({
        slug,
        name,
        description:
          typeof product.description === "string" ? product.description : "",
        price,
        isVegetarian: product.isVegetarian,
        classification: classification as ProductClassification,
        subcategory,
        isSignature: product.isSignature === true,
        categoryId: category.id,
        variants,
        comboItems,
      });
    }

    if (categoriesById.size === 0 || normalizedProducts.length === 0) {
      throw new Error("Production menu returned no categories or active products");
    }

    return {
      categories: [...categoriesById.values()],
      products: normalizedProducts,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseVariants(value: unknown) {
  if (!Array.isArray(value)) return null;
  const variants: { name: string; price: string }[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const name = text((item as { name?: unknown }).name);
    const rawPrice = (item as { price?: unknown }).price;
    if (typeof rawPrice !== "number" && typeof rawPrice !== "string") return null;
    if (!name || names.has(name.toLocaleLowerCase())) return null;
    try {
      const price = toDecimalString(
        toMinorUnits(rawPrice, `Price for ${name}`),
      );
      names.add(name.toLocaleLowerCase());
      variants.push({ name, price });
    } catch {
      return null;
    }
  }
  return variants;
}

router.use(admin);

router.get("/order-reports", async (_req, res) => {
  try {
    return res.json(await getOrderReportSummary());
  } catch (error) {
    console.error("Order report summary error:", error);
    return res.status(500).json({
      message: "Unable to load order report information",
    });
  }
});

router.post("/catalog/sync", async (_req, res) => {
  if (process.env.BIGBITES_ENABLE_PRODUCTION_CATALOG_SYNC !== "true") {
    return res.status(409).json({
      message: "Production menu sync is disabled for this local POS server",
    });
  }

  if (!usesInstalledLocalDatabase()) {
    return res.status(409).json({
      message:
        "Production menu sync is only available when the server targets the installed local POS database",
    });
  }

  let missingCatalogColumns: string[];
  try {
    missingCatalogColumns = await getMissingCatalogSchemaColumns();
  } catch (error) {
    console.error("Unable to verify local catalog schema:", error);
    return res.status(503).json({
      message:
        "Unable to verify the local catalog schema; the production menu was not fetched and local data was not changed",
    });
  }
  if (missingCatalogColumns.length > 0) {
    return res.status(409).json({
      message:
        "The installed local schema cannot safely store the production catalog's variants or combo definitions. No catalog data was imported; apply an approved schema update before syncing.",
      missingColumns: missingCatalogColumns,
    });
  }

  let productionMenu: Awaited<ReturnType<typeof fetchProductionMenu>>;
  try {
    productionMenu = await fetchProductionMenu();
  } catch (error) {
    console.error("Production menu fetch failed:", error);
    return res.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : "Unable to load the production menu; local data was not changed",
    });
  }

  try {
    const summary = await prisma.$transaction(
      async (tx) => {
        const localCategoryIds = new Map<number, number>();
        for (const category of productionMenu.categories) {
          const localCategory = await tx.category.upsert({
            where: { name: category.name },
            create: { name: category.name, sortOrder: category.sortOrder },
            update: { sortOrder: category.sortOrder },
            select: { id: true },
          });
          localCategoryIds.set(category.id, localCategory.id);
        }

        let variantCount = 0;
        for (const product of productionMenu.products) {
          const categoryId = localCategoryIds.get(product.categoryId);
          if (!categoryId) {
            throw new Error(`No local category was created for ${product.name}`);
          }

          const catalogFields = {
            slug: product.slug,
            name: product.name,
            description: product.description,
            price: product.price,
            isVegetarian: product.isVegetarian,
            classification: product.classification,
            subcategory: product.subcategory,
            isSignature: product.isSignature,
            isActive: true,
            categoryId,
            comboItems: product.comboItems ?? Prisma.DbNull,
          };
          const localProduct = await tx.product.upsert({
            where: { slug: product.slug },
            create: {
              ...catalogFields,
            },
            update: catalogFields,
            select: { id: true },
          });

          for (const variant of product.variants) {
            await tx.productVariant.upsert({
              where: {
                productId_name: {
                  productId: localProduct.id,
                  name: variant.name,
                },
              },
              create: {
                productId: localProduct.id,
                name: variant.name,
                price: variant.price,
                isActive: true,
              },
              update: { price: variant.price, isActive: true },
            });
            variantCount += 1;
          }
        }

        return {
          categories: productionMenu.categories.length,
          products: productionMenu.products.length,
          variants: variantCount,
        };
      },
      { timeout: 60_000 },
    );

    return res.json(summary);
  } catch (error) {
    console.error("Local production catalog sync failed:", error);
    return res.status(500).json({
      message: "Unable to sync the production catalog; local transaction rolled back",
    });
  }
});

router.post("/order-reports/export", async (_req, res) => {
  try {
    return res.json({ reports: await exportAllOrderReports() });
  } catch (error) {
    console.error("Order report export error:", error);
    return res.status(503).json({
      message:
        error instanceof Error
          ? error.message
          : "Unable to export monthly order reports",
    });
  }
});

router.post("/order-reports/export/:month", async (req, res) => {
  try {
    const report = await exportMonthlyOrderReport(req.params.month);
    return res.json({ reports: [report] });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Report month")
    ) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Monthly order report export error:", error);
    return res.status(503).json({
      message:
        error instanceof Error
          ? error.message
          : "Unable to export the selected monthly order report",
    });
  }
});

router.get("/settings", async (_req, res) => {
  const settings = await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    create: { id: 1, gstRate: 5, gstEnabled: true },
    update: {},
  });

  res.json({
    gstRate: Number(settings.gstRate),
    gstEnabled: settings.gstEnabled,
    orderReportsPath: settings.orderReportsPath,
    restaurantAddress: settings.restaurantAddress,
    fssaiEnabled: settings.fssaiEnabled,
    fssaiNumber: settings.fssaiNumber,
    gstinEnabled: settings.gstinEnabled,
    gstinNumber: settings.gstinNumber,
  });
});

router.patch("/settings", async (req, res) => {
  const data: {
    gstRate?: number;
    gstEnabled?: boolean;
    orderReportsPath?: string;
    restaurantAddress?: string;
    fssaiEnabled?: boolean;
    fssaiNumber?: string;
    gstinEnabled?: boolean;
    gstinNumber?: string;
  } = {};

  if (req.body?.gstRate !== undefined) {
    try {
      data.gstRate =
        Number(toRateBasisPoints(req.body.gstRate, "GST rate")) / 100;
    } catch {
      return res.status(400).json({
        message: "GST must be a number from 0 to 100 with at most 2 decimal places",
      });
    }
  }

  if (req.body?.gstEnabled !== undefined) {
    if (typeof req.body.gstEnabled !== "boolean") {
      return res.status(400).json({
        message: "gstEnabled must be a boolean",
      });
    }
    data.gstEnabled = req.body.gstEnabled;
  }

  if (req.body?.orderReportsPath !== undefined) {
    if (
      typeof req.body.orderReportsPath !== "string" ||
      req.body.orderReportsPath.trim().length > 2048
    ) {
      return res.status(400).json({
        message: "Order report folder must be text up to 2048 characters",
      });
    }
    const reportPath = req.body.orderReportsPath.trim();
    if (reportPath && !path.isAbsolute(reportPath)) {
      return res.status(400).json({
        message: "Order report folder must be an absolute path",
      });
    }
    data.orderReportsPath = reportPath;
  }

  if (req.body?.restaurantAddress !== undefined) {
    if (
      typeof req.body.restaurantAddress !== "string" ||
      req.body.restaurantAddress.length > 1000
    ) {
      return res.status(400).json({
        message: "Restaurant address must be text up to 1000 characters",
      });
    }
    data.restaurantAddress = req.body.restaurantAddress.trim();
  }

  for (const field of ["fssaiEnabled", "gstinEnabled"] as const) {
    if (req.body?.[field] !== undefined) {
      if (typeof req.body[field] !== "boolean") {
        return res.status(400).json({
          message: `${field} must be a boolean`,
        });
      }
      data[field] = req.body[field];
    }
  }

  for (const field of ["fssaiNumber", "gstinNumber"] as const) {
    if (req.body?.[field] !== undefined) {
      const value = req.body[field];
      if (typeof value !== "string" || value.trim().length > 100) {
        return res.status(400).json({
          message: `${field} must be text up to 100 characters`,
        });
      }
      data[field] = value.trim();
    }
  }

  const currentSettings = await prisma.restaurantSettings.findUnique({
    where: { id: 1 },
    select: {
      fssaiEnabled: true,
      fssaiNumber: true,
      gstinEnabled: true,
      gstinNumber: true,
    },
  });
  const nextFssaiEnabled =
    data.fssaiEnabled ?? currentSettings?.fssaiEnabled ?? false;
  const nextFssaiNumber =
    data.fssaiNumber ?? currentSettings?.fssaiNumber ?? "";
  if (nextFssaiEnabled && !nextFssaiNumber.trim()) {
    return res.status(400).json({
      message: "Enter the FSSAI number before enabling FSSAI",
    });
  }

  const nextGstinEnabled =
    data.gstinEnabled ?? currentSettings?.gstinEnabled ?? false;
  const nextGstinNumber =
    data.gstinNumber ?? currentSettings?.gstinNumber ?? "";
  if (nextGstinEnabled && !nextGstinNumber.trim()) {
    return res.status(400).json({
      message: "Enter the GSTIN number before enabling GSTIN",
    });
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({
      message: "Provide at least one valid restaurant setting",
    });
  }

  const settings = await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      gstRate: data.gstRate ?? 5,
      gstEnabled: data.gstEnabled ?? true,
      orderReportsPath: data.orderReportsPath ?? "",
      restaurantAddress: data.restaurantAddress ?? "",
      fssaiEnabled: data.fssaiEnabled ?? false,
      fssaiNumber: data.fssaiNumber ?? "",
      gstinEnabled: data.gstinEnabled ?? false,
      gstinNumber: data.gstinNumber ?? "",
    },
    update: data,
  });

  return res.json({
    gstRate: Number(settings.gstRate),
    gstEnabled: settings.gstEnabled,
    orderReportsPath: settings.orderReportsPath,
    restaurantAddress: settings.restaurantAddress,
    fssaiEnabled: settings.fssaiEnabled,
    fssaiNumber: settings.fssaiNumber,
    gstinEnabled: settings.gstinEnabled,
    gstinNumber: settings.gstinNumber,
  });
});

router.get("/dashboard", async (_req, res) => {
  const [orders, completedOrders, paidPayments, products, categories, totalTables, availableTables, occupiedTables] = await Promise.all([
    prisma.order.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.payment.findMany({
      where: { status: "PAID" },
      select: {
        order: {
          select: {
            total: true,
            gstRate: true,
            discountType: true,
            discountValue: true,
          },
        },
      },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.category.count(),
    prisma.restaurantTable.count(),
    prisma.restaurantTable.count({ where: { status: "AVAILABLE" } }),
    prisma.restaurantTable.count({ where: { status: "OCCUPIED" } }),
  ]);
  const revenue = sumOrderAmounts(paidPayments.map(({ order }) => order));
  res.json({
    openOrders: orders,
    pendingOrders: orders,
    completedOrders,
    totalOrders: orders + completedOrders,
    revenue: revenue.grandTotal,
    activeProducts: products,
    totalCategories: categories,
    totalTables,
    availableTables,
    occupiedTables,
  });
});

router.get("/users", async (_req, res) => res.json(await prisma.user.findMany({ select: safeUser, orderBy: { name: "asc" } })));
router.post("/users", async (req, res) => {
  const name = text(req.body.name), username = text(req.body.username), password = text(req.body.password), role = req.body.role;
  if (!name || !username || !password || !["ADMIN", "CASHIER", "WAITER"].includes(role)) return res.status(400).json({ message: "Valid name, username, password and role are required" });
  const passwordHash = await hashPassword(password);
  try { res.status(201).json(await prisma.user.create({ data: { name, username, password: passwordHash, role }, select: safeUser })); } catch { res.status(409).json({ message: "Username already exists" }); }
});
router.patch("/users/:id", async (req, res) => {
  const userId = id(req.params.id); if (!userId) return res.status(400).json({ message: "Invalid user ID" });
  const data: Record<string, unknown> = {};
  if (text(req.body.name)) data.name = text(req.body.name);
  if (req.body.username !== undefined) {
    const username = text(req.body.username);
    if (!username) return res.status(400).json({ message: "A valid username is required" });
    data.username = username;
  }
  const password = text(req.body.password);
  if (password) data.password = await hashPassword(password);
  if (req.body.role !== undefined) {
    if (!["ADMIN", "CASHIER", "WAITER"].includes(req.body.role)) {
      return res.status(400).json({ message: "Valid role is required" });
    }
    data.role = req.body.role;
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: "No valid changes" });
  try {
    res.json(await prisma.user.update({ where: { id: userId }, data, select: safeUser }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "Username already exists" });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    throw error;
  }
});
router.delete("/users/:id", async (req, res) => {
  const userId = id(req.params.id);
  if (!userId) return res.status(400).json({ message: "Invalid user ID" });
  if (req.user?.id === userId) {
    return res.status(409).json({ message: "You cannot delete your own account" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (
      user.role === "ADMIN" &&
      (await prisma.user.count({ where: { role: "ADMIN" } })) <= 1
    ) {
      return res.status(409).json({ message: "The last admin account cannot be deleted" });
    }

    if ((await prisma.order.count({ where: { waiterId: userId } })) > 0) {
      return res.status(409).json({
        message: "This user has order history and cannot be deleted",
      });
    }

    await prisma.user.delete({ where: { id: userId } });
    return res.status(204).end();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return res.status(409).json({
        message: "This user is linked to existing records and cannot be deleted",
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({ message: "User not found" });
    }
    console.error("Delete user error:", error);
    return res.status(500).json({ message: "Failed to delete user" });
  }
});

router.get("/categories", async (_req, res) => res.json(await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })));
router.post("/categories", async (req, res) => { const name = text(req.body.name); if (!name) return res.status(400).json({ message: "Category name is required" }); try { res.status(201).json(await prisma.category.create({ data: { name } })); } catch { res.status(409).json({ message: "Category already exists" }); } });
router.patch("/categories/:id", async (req, res) => { const categoryId = id(req.params.id), name = text(req.body.name); if (!categoryId || !name) return res.status(400).json({ message: "Valid category ID and name are required" }); try { res.json(await prisma.category.update({ where: { id: categoryId }, data: { name } })); } catch { res.status(404).json({ message: "Category not found" }); } });

router.get("/products", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true, variants: { orderBy: { id: "asc" } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    });

    return res.json(
      products.map((product) => ({
        ...product,
        price: Number(product.price),
        isVegetarian: Boolean(product.isVegetarian),
        isSignature: Boolean(product.isSignature),
        variants: product.variants.map((variant) => ({
          ...variant,
          price: Number(variant.price),
        })),
      })),
    );
  } catch (error) {
    console.error("List products error:", error);
    return res.status(500).json({ message: "Unable to load menu" });
  }
});

router.post("/products", async (req, res) => {
  const name = text(req.body.name);
  const categoryId = id(req.body.categoryId);
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const isVegetarian = req.body.isVegetarian !== undefined ? Boolean(req.body.isVegetarian) : true;
  const isSignature = Boolean(req.body.isSignature);
  const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : true;
  const validClassifications = Object.values(ProductClassification);
  const classification = req.body.classification === undefined
    ? (isVegetarian ? ProductClassification.VEG : ProductClassification.NON_VEG)
    : req.body.classification;
  if (!validClassifications.includes(classification)) {
    return res.status(400).json({ message: "Invalid product classification" });
  }
  const subcategory = typeof req.body.subcategory === "string" ? req.body.subcategory.trim() || null : null;
  const variants = req.body.variants === undefined ? [] : parseVariants(req.body.variants);
  if (variants === null) {
    return res.status(400).json({ message: "Variants must have unique names and valid prices" });
  }
  let price: string;
  try {
    price = toDecimalString(toMinorUnits(req.body.price, "Price"));
  } catch {
    return res.status(400).json({
      message: "Price must be a non-negative amount with at most 2 decimal places",
    });
  }
  if (!name || !categoryId) {
    return res.status(400).json({
      message: "Valid name and category are required",
    });
  }
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    return res.status(404).json({ message: "Category not found" });
  }
  try {
    const product = await prisma.product.create({
      data: {
        name,
        slug: `${slugify(category.name)}-${slugify(name)}`,
        description,
        categoryId,
        price,
        isVegetarian: classification === ProductClassification.VEG,
        classification,
        subcategory,
        isSignature,
        isActive,
        variants: { create: variants },
      },
      include: { category: true, variants: { where: { isActive: true }, orderBy: { id: "asc" } } },
    });
    return res.status(201).json({
      ...product,
      price: Number(product.price),
      variants: product.variants.map((variant) => ({
        ...variant,
        price: Number(variant.price),
      })),
    });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(400).json({ message: "Unable to create product" });
  }
});
router.patch("/products/:id", async (req, res) => {
  const productId = id(req.params.id);
  if (!productId) return res.status(400).json({ message: "Invalid product ID" });
  const data: {
    name?: string;
    description?: string;
    categoryId?: number;
    price?: string;
    isVegetarian?: boolean;
    classification?: ProductClassification;
    subcategory?: string | null;
    isSignature?: boolean;
    isActive?: boolean;
    stockUnit?: string;
    lowStockThreshold?: number;
  } = {};
  if (req.body.name !== undefined) {
    const name = text(req.body.name);
    if (!name) return res.status(400).json({ message: "A valid product name is required" });
    data.name = name;
  }
  if (req.body.description !== undefined) {
    data.description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  }
  if (req.body.categoryId !== undefined) {
    const categoryId = id(req.body.categoryId);
    if (!categoryId) return res.status(400).json({ message: "A valid category is required" });
    data.categoryId = categoryId;
  }
  if (req.body.price !== undefined) {
    try {
      data.price = toDecimalString(toMinorUnits(req.body.price, "Price"));
    } catch {
      return res.status(400).json({
        message: "Price must be a non-negative amount with at most 2 decimal places",
      });
    }
  }
  if (req.body.classification !== undefined) {
    if (!Object.values(ProductClassification).includes(req.body.classification)) {
      return res.status(400).json({ message: "Invalid product classification" });
    }
    data.classification = req.body.classification;
    data.isVegetarian = req.body.classification === ProductClassification.VEG;
  } else if (typeof req.body.isVegetarian === "boolean") {
    data.isVegetarian = req.body.isVegetarian;
    data.classification = req.body.isVegetarian
      ? ProductClassification.VEG
      : ProductClassification.NON_VEG;
  }
  if (req.body.subcategory !== undefined) {
    if (req.body.subcategory !== null && typeof req.body.subcategory !== "string") {
      return res.status(400).json({ message: "Subcategory must be text" });
    }
    data.subcategory = typeof req.body.subcategory === "string"
      ? req.body.subcategory.trim() || null
      : null;
  }
  if (typeof req.body.isSignature === "boolean") data.isSignature = req.body.isSignature;
  if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive;
  if (req.body.stockUnit !== undefined) {
    const stockUnit = text(req.body.stockUnit);
    if (!stockUnit) {
      return res.status(400).json({ message: "A valid stock unit is required" });
    }
    data.stockUnit = stockUnit;
  }
  if (req.body.lowStockThreshold !== undefined) {
    const lowStockThreshold = Number(req.body.lowStockThreshold);
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      return res.status(400).json({
        message: "Low-stock threshold must be a non-negative integer",
      });
    }
    data.lowStockThreshold = lowStockThreshold;
  }
  const variants = req.body.variants === undefined ? undefined : parseVariants(req.body.variants);
  if (variants === null) {
    return res.status(400).json({ message: "Variants must have unique names and valid prices" });
  }
  if (!Object.keys(data).length && variants === undefined) {
    return res.status(400).json({ message: "No valid changes" });
  }
  try {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!existing) {
        throw new Error("PRODUCT_NOT_FOUND");
      }
      const combo = getComboDefinition(existing.slug);
      if (combo && data.name !== undefined && data.name !== combo.name) {
        throw new Error("FIXED_COMBO_NAME");
      }
      if (
        combo &&
        data.price !== undefined &&
        toMinorUnits(data.price, "Price") !== toMinorUnits(combo.price, "Combo price")
      ) {
        throw new Error("FIXED_COMBO_PRICE");
      }
      await tx.product.update({
        where: { id: productId },
        data,
      });
      if (variants !== undefined) {
        for (const variant of variants) {
          await tx.productVariant.upsert({
            where: {
              productId_name: { productId, name: variant.name },
            },
            update: { price: variant.price, isActive: true },
            create: { productId, ...variant },
          });
        }
        await tx.productVariant.updateMany({
          where: {
            productId,
            ...(variants.length
              ? { name: { notIn: variants.map((variant) => variant.name) } }
              : {}),
          },
          data: { isActive: false },
        });
      }
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: { category: true, variants: { orderBy: { id: "asc" } } },
      });
    });
    return res.json({
      ...product,
      price: Number(product.price),
      variants: product.variants.map((variant) => ({
        ...variant,
        price: Number(variant.price),
      })),
    });
  } catch (error) {
    console.error("Update product error:", error);
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }
    if (error instanceof Error && error.message === "FIXED_COMBO_PRICE") {
      return res.status(409).json({
        message: "Combo prices are fixed and cannot be changed through product editing",
      });
    }
    if (error instanceof Error && error.message === "FIXED_COMBO_NAME") {
      return res.status(409).json({
        message: "Combo names are fixed and cannot be changed through product editing",
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2025")
    ) {
      return res.status(404).json({ message: "Product or category not found" });
    }
    return res.status(500).json({ message: "Unable to update product" });
  }
});

router.patch("/products/:id/stock", async (req, res) => {
  const productId = id(req.params.id);
  if (!productId) return res.status(400).json({ message: "Invalid product ID" });

  const hasNewStock = req.body.newStock !== undefined;
  const hasRestockQuantity = req.body.quantity !== undefined;
  if (hasNewStock === hasRestockQuantity) {
    return res.status(400).json({
      message: "Provide exactly one of newStock or restock quantity",
    });
  }
  const newStock = hasNewStock ? Number(req.body.newStock) : null;
  const restockQuantity = hasRestockQuantity ? Number(req.body.quantity) : null;
  if (
    (newStock !== null && (!Number.isInteger(newStock) || newStock < 0)) ||
    (restockQuantity !== null &&
      (!Number.isInteger(restockQuantity) || restockQuantity <= 0))
  ) {
    return res.status(400).json({
      message: "Stock must be a non-negative integer or restock quantity a positive integer",
    });
  }
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length > 200) {
    return res.status(400).json({ message: "Stock reason must be 200 characters or fewer" });
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE
      `;
      const current = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!current) throw new Error("PRODUCT_NOT_FOUND");
      if (current.lastStockUpdatedAt === null && newStock === null) {
        throw new Error("STOCK_INITIALIZATION_REQUIRED");
      }

      const previousStock = current.stock;
      const nextStock = newStock ?? previousStock + (restockQuantity ?? 0);
      const initializing = current.lastStockUpdatedAt === null;
      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          stock: nextStock,
          lastStockUpdatedAt: new Date(),
          ...(req.body.stockUnit === undefined
            ? {}
            : { stockUnit: text(req.body.stockUnit) ?? current.stockUnit }),
          ...(req.body.lowStockThreshold === undefined
            ? {}
            : { lowStockThreshold: Number(req.body.lowStockThreshold) }),
        },
        include: { category: true, variants: { orderBy: { id: "asc" } } },
      });

      await tx.productStockMovement.create({
        data: {
          productId,
          movementType: initializing
            ? "INITIALIZATION"
            : newStock !== null
              ? "ADJUSTMENT"
              : "RESTOCK",
          quantity: initializing ? nextStock : nextStock - previousStock,
          previousStock,
          newStock: nextStock,
          reason:
            reason ||
            (initializing
              ? "Administrator initialized stock"
              : newStock !== null
                ? "Administrator adjusted stock"
                : "Administrator restocked product"),
        },
      });
      return updated;
    });

    return res.json({
      ...product,
      price: Number(product.price),
      variants: product.variants.map((variant) => ({
        ...variant,
        price: Number(variant.price),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }
    if (
      error instanceof Error &&
      error.message === "STOCK_INITIALIZATION_REQUIRED"
    ) {
      return res.status(409).json({
        message: "Set an explicit starting stock count before restocking this product",
      });
    }
    console.error("Stock update error:", error);
    return res.status(500).json({ message: "Unable to update stock" });
  }
});

router.delete("/products/:id", async (req, res) => {
  const productId = id(req.params.id);
  if (!productId) return res.status(400).json({ message: "Invalid product ID" });

  try {
    const existing = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        orderItems: { select: { id: true } },
        stockMovements: { select: { id: true } },
      },
    });
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (existing.orderItems.length > 0 || existing.stockMovements.length > 0) {
      const deactivated = await prisma.product.update({
        where: { id: productId },
        data: {
          isActive: false,
        },
      });
      return res.status(200).json({
        message: "This product has historical order records, so it was deactivated instead of permanently deleted.",
        product: deactivated,
      });
    }

    try {
      await prisma.product.delete({ where: { id: productId } });
      return res.status(204).send();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2003"
      ) {
        throw error;
      }

      const deactivated = await prisma.product.update({
        where: { id: productId },
        data: { isActive: false },
      });
      return res.status(200).json({
        message: "This product has historical records, so it was deactivated instead of permanently deleted.",
        product: deactivated,
      });
    }
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(400).json({ message: "Unable to delete product" });
  }
});

router.get("/tables", async (_req, res) => res.json(await prisma.restaurantTable.findMany({ orderBy: { number: "asc" } })));
router.post("/tables", async (req, res) => { const number = Number(req.body.number); if (!Number.isInteger(number) || number <= 0) return res.status(400).json({ message: "Valid table number is required" }); try { res.status(201).json(await prisma.restaurantTable.create({ data: { number } })); } catch { res.status(409).json({ message: "Table number already exists" }); } });
router.patch("/tables/:id", async (req, res) => { const tableId = id(req.params.id), status = req.body.status; if (!tableId || !["AVAILABLE", "OCCUPIED", "RESERVED"].includes(status)) return res.status(400).json({ message: "Valid table ID and status are required" }); try { res.json(await prisma.restaurantTable.update({ where: { id: tableId }, data: { status } })); } catch { res.status(404).json({ message: "Table not found" }); } });

router.get("/orders", async (_req, res) => {
  const orders = await prisma.order.findMany({
    include: {
      items: { include: { product: true, variant: true } },
      table: true,
      waiter: { select: safeUser },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    orders.map((order) => ({
      ...order,
      ...calculateOrderAmounts(order),
    })),
  );
});
router.delete("/orders/:id", requireRoles("ADMIN"), async (req, res) => {
  const orderId = id(req.params.id);
  if (!orderId) return res.status(400).json({ message: "Invalid order ID" });

  try {
    await prisma.$transaction(async (tx) => {
      await lockOrderSequence(tx);

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { tableId: true },
      });
      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;

      const currentOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          payment: true,
        },
      });
      if (!currentOrder) {
        throw new Error("ORDER_NOT_FOUND");
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "RestaurantTable"
        WHERE "id" = ${currentOrder.tableId}
        FOR UPDATE
      `;

      if (
        currentOrder.status !== "CANCELLED" &&
        currentOrder.status !== "COMPLETED" &&
        currentOrder.payment?.status !== "PAID" &&
        currentOrder.payment?.status !== "REFUNDED"
      ) {
        await restoreOrderStock(tx, orderId);
      }

      await tx.payment.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });

      const otherActiveOrder = await tx.order.findFirst({
        where: {
          tableId: currentOrder.tableId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        select: { id: true },
      });
      const table = await tx.restaurantTable.findUnique({
        where: { id: currentOrder.tableId },
        select: { status: true },
      });

      if (!otherActiveOrder && table?.status === "OCCUPIED") {
        await tx.restaurantTable.update({
          where: { id: currentOrder.tableId },
          data: { status: "AVAILABLE" },
        });
      }

      await resetOrderSequenceIfEmpty(tx);
    });

    return res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("Delete order error:", error);
    return res.status(500).json({ message: "Failed to delete order" });
  }
});
router.get("/payments", async (_req, res) => res.json(await prisma.payment.findMany({ include: { order: true }, orderBy: { createdAt: "desc" } })));

export default router;
