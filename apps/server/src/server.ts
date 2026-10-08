import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { prisma } from "./config/database.js";
import productsRouter from "./routes/products.js";
import tablesRouter from "./routes/tables.js";
import authRouter from "./routes/auth.js";
import ordersRouter from "./routes/orders.js";
import billingRouter from "./routes/billing.js";
import adminRouter from "./routes/admin.js";
import { optionalAuth, validateAuthSecret } from "./middleware/auth.js";

dotenv.config();
validateAuthSecret();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT) || 3001;
const DISCOVERY_REQUEST = "BIGBITES_POS_DISCOVERY_V1";

function ipv4ToNumber(address: string) {
  return address
    .split(".")
    .reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0;
}

function isPrivateIPv4(address: string) {
  const octets = address.split(".").map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function getLanIPv4(clientAddress?: string) {
  const addresses = Object.values(networkInterfaces())
    .flatMap((network) => network ?? [])
    .filter(
      (address) =>
        address.family === "IPv4" &&
        !address.internal &&
        isPrivateIPv4(address.address),
    );
  const sameSubnet = clientAddress
    ? addresses.filter((address) => {
        const mask = ipv4ToNumber(address.netmask);
        return (
          (ipv4ToNumber(address.address) & mask) ===
          (ipv4ToNumber(clientAddress) & mask)
        );
      })
    : [];
  const candidates = sameSubnet.length ? sameSubnet : addresses;

  candidates.sort((left, right) => {
    const priority = (address: string) => {
      const octets = address.split(".").map(Number);
      return octets[0] === 192 && octets[1] === 168 ? 0 : 1;
    };
    return priority(left.address) - priority(right.address);
  });

  return candidates[0]?.address;
}

const discoverySocket = createSocket("udp4");
discoverySocket.on("error", (error) => {
  console.error("LAN discovery socket error:", error);
});
discoverySocket.on("message", (message, remote) => {
  if (message.toString("utf8") !== DISCOVERY_REQUEST) return;

  const host = getLanIPv4(remote.address);
  if (!host) {
    console.error("LAN discovery request received, but no private IPv4 was found.");
    return;
  }

  discoverySocket.send(
    JSON.stringify({ service: "big-bites-pos", host, port: PORT }),
    remote.port,
    remote.address,
    (error) => {
      if (error) console.error("Unable to reply to LAN discovery request:", error);
    },
  );
});
discoverySocket.bind(DISCOVERY_PORT, HOST, () => {
  console.log(`LAN discovery listening on udp://${HOST}:${DISCOVERY_PORT}`);
});

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

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found" });
});

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