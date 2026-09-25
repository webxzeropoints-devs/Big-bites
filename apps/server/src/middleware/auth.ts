import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

export type AuthUser = { id: number; username: string; role: UserRole };

const getSecret = () => process.env.AUTH_SECRET ?? "hotel-pos-development-secret";

export function createToken(user: AuthUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readToken(value?: string): AuthUser | null {
  if (!value?.startsWith("Bearer ")) return null;
  const [payload, signature] = value.slice(7).split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthUser;
    return Number.isInteger(user.id) && !!user.role ? user : null;
  } catch {
    return null;
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const user = readToken(req.headers.authorization);
  if (user) req.user = user;
  next();
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Authentication required" });
    if (roles.length && !roles.includes(user.role)) return res.status(403).json({ message: "Insufficient permissions" });
    next();
  };
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}
