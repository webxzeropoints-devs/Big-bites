ALTER TABLE "Order"
ADD COLUMN "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE TABLE "RestaurantSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RestaurantSettings" ("id", "gstRate", "updatedAt")
VALUES (1, 5, CURRENT_TIMESTAMP);
