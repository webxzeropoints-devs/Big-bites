ALTER TABLE "RestaurantTable"
ADD COLUMN "isParcel" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "RestaurantTable" ("number", "isParcel", "status", "createdAt", "updatedAt")
VALUES (0, true, 'AVAILABLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("number") DO UPDATE
SET "isParcel" = true;
