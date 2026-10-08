import { Router } from "express";
import { prisma } from "../config/database.js";
import { createToken } from "../middleware/auth.js";
import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from "../utils/password.js";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== "string" ||
      !username ||
      typeof password !== "string" ||
      !password
    ) {
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

    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    if (!isPasswordHash(user.password)) {
      const upgradedPassword = await hashPassword(password);
      await prisma.user.updateMany({
        where: { id: user.id, password: user.password },
        data: { password: upgradedPassword },
      });
    }

    return res.json({
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