import { Router } from "express";
import { prisma } from "../config/database.js";

const router = Router();

router.get("/categories", async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: { select: { products: { where: { isActive: true } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json(categories);
  } catch (error) {
    console.error("Error fetching menu categories:", error);
    return res.status(500).json({ message: "Failed to fetch menu categories" });
  }
});

// GET /api/products
// Returns all active products with their categories
router.get("/", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },
      include: {
        category: true,
        variants: {
          where: { isActive: true },
          orderBy: { id: "asc" },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    const normalizedProducts = products.map((product) => ({
      ...product,
      price: Number(product.price),
      stock: Number(product.stock),
      lowStockThreshold: Number(product.lowStockThreshold ?? 0),
      isVegetarian: Boolean(product.isVegetarian),
      isSignature: Boolean(product.isSignature),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        price: Number(variant.price),
      })),
      isAvailable: product.stock > 0,
    }));

    normalizedProducts.sort(
      (left, right) =>
        left.category.sortOrder - right.category.sortOrder ||
        left.name.localeCompare(right.name),
    );
    return res.json(normalizedProducts);
  } catch (error) {
    console.error("Error fetching products:", error);

    res.status(500).json({
      message: "Failed to fetch products",
    });
  }
});

// GET /api/products/:id
// Returns one product
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        message: "Invalid product ID",
      });
    }

    const product = await prisma.product.findUnique({
      where: {
        id,
      },
      include: {
        category: true,
        variants: {
          where: { isActive: true },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    return res.json({
      ...product,
      price: Number(product.price),
      stock: Number(product.stock),
      lowStockThreshold: Number(product.lowStockThreshold ?? 0),
      isVegetarian: Boolean(product.isVegetarian),
      isSignature: Boolean(product.isSignature),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        price: Number(variant.price),
      })),
      isAvailable: product.stock > 0,
    });
  } catch (error) {
    console.error("Error fetching product:", error);

    res.status(500).json({
      message: "Failed to fetch product",
    });
  }
});

export default router;