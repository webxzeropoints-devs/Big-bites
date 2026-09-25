import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "./config/database.js";
import productsRouter from "./routes/products.js";
import tablesRouter from "./routes/tables.js";
import authRouter from "./routes/auth.js";
import ordersRouter from "./routes/orders.js";
import billingRouter from "./routes/billing.js";
import adminRouter from "./routes/admin.js";
import { optionalAuth } from "./middleware/auth.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

// Middleware
app.use(cors());
app.use(express.json());
app.use(optionalAuth);

// API Routes
app.use("/api/products", productsRouter);
app.use("/api/tables", tablesRouter);
app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/billing", billingRouter);
app.use("/api/admin", adminRouter);

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "BIG BITES Server is running!",
  });
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "OK",
      database: "Connected",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
    });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});