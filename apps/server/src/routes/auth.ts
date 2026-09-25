import { Router } from "express";
import { prisma } from "../config/database.js";
import { createToken } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check required fields
    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: {
        username,
      },
    });

    // Check username/password
    if (!user || user.password !== password) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    // Login successful
    res.json({
      message: "Login successful",
      token: createToken({ id: user.id, username: user.username, role: user.role }),
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error instanceof Error ? error.message : error);

    res.status(500).json({
      message: "Login failed",
    });
  }
});

export default router;