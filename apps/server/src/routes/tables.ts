import { Router } from "express";
import { prisma } from "../config/database.js";

const router = Router();

// GET /api/tables
// Get all restaurant tables
router.get("/", async (req, res) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      orderBy: {
        number: "asc",
      },
    });

    res.json(tables);
  } catch (error) {
    console.error("Error fetching tables:", error);

    res.status(500).json({
      message: "Failed to fetch tables",
    });
  }
});

// GET /api/tables/:id
// Get one table
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        message: "Invalid table ID",
      });
    }

    const table = await prisma.restaurantTable.findUnique({
      where: {
        id,
      },
    });

    if (!table) {
      return res.status(404).json({
        message: "Table not found",
      });
    }

    res.json(table);
  } catch (error) {
    console.error("Error fetching table:", error);

    res.status(500).json({
      message: "Failed to fetch table",
    });
  }
});

export default router;