import type { NextFunction, Request, Response } from "express";

const TENANT_HEADER = "x-tenant-id";
const TENANT_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.header(TENANT_HEADER);

  if (!tenantId || !TENANT_REGEX.test(tenantId)) {
    return res.status(400).json({
      error: "Missing or invalid tenant id",
      hint: `Provide header ${TENANT_HEADER} with 2-64 characters (letters, numbers, _ or -).`
    });
  }

  req.tenantId = tenantId;
  next();
}
