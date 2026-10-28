ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "comboItems" JSONB;

ALTER TABLE "OrderItem"
ADD COLUMN IF NOT EXISTS "comboSnapshot" JSONB;

INSERT INTO "Category" ("name", "sortOrder", "createdAt", "updatedAt")
VALUES
	('Couples/Friends Combo', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('Family Combo', 101, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

DO $combo_catalog$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "Product"
		WHERE "name" = 'Couples/Friends Combo'
		  AND "slug" <> 'couples-friends-combo-couples-friends-combo'
	) THEN
		RAISE EXCEPTION 'A Couples/Friends Combo product already exists with a noncanonical slug';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "Product"
		WHERE "name" = 'Family Combo'
		  AND "slug" <> 'family-combo-family-combo'
	) THEN
		RAISE EXCEPTION 'A Family Combo product already exists with a noncanonical slug';
	END IF;

	INSERT INTO "Product" (
		"slug", "name", "description", "price", "isVegetarian", "classification",
		"subcategory", "isSignature", "isActive", "categoryId", "comboItems",
		"createdAt", "updatedAt"
	)
	SELECT
		'couples-friends-combo-couples-friends-combo',
		'Couples/Friends Combo',
		'Fixed-price combo: Chicken Rice, Chicken Briyani, BBQ Quarter, Chicken Lollipop',
		499.00,
		false,
		'NOT_APPLICABLE'::"ProductClassification",
		NULL,
		false,
		true,
		category."id",
		'[{"name":"Chicken Rice","quantity":1},{"name":"Chicken Briyani","quantity":1},{"name":"BBQ Quarter","quantity":1},{"name":"Chicken Lollipop","quantity":1}]'::jsonb,
		CURRENT_TIMESTAMP,
		CURRENT_TIMESTAMP
	FROM "Category" AS category
	WHERE category."name" = 'Couples/Friends Combo'
	ON CONFLICT ("slug") DO NOTHING;

	IF NOT EXISTS (
		SELECT 1 FROM "Product" AS product
		JOIN "Category" AS category ON category."id" = product."categoryId"
		WHERE product."slug" = 'couples-friends-combo-couples-friends-combo'
		  AND product."name" = 'Couples/Friends Combo'
		  AND category."name" = 'Couples/Friends Combo'
	) THEN
		RAISE EXCEPTION 'Combo product slug couples-friends-combo-couples-friends-combo conflicts with a different product or category';
	END IF;

	INSERT INTO "Product" (
		"slug", "name", "description", "price", "isVegetarian", "classification",
		"subcategory", "isSignature", "isActive", "categoryId", "comboItems",
		"createdAt", "updatedAt"
	)
	SELECT
		'family-combo-family-combo',
		'Family Combo',
		'Fixed-price combo: Chicken Rice, Chicken Briyani, Chicken Noodles, Butter Naan, Roti, Chicken Masala, Dragon Chicken, Saucy Lollipop, BBQ Quarter',
		999.00,
		false,
		'NOT_APPLICABLE'::"ProductClassification",
		NULL,
		false,
		true,
		category."id",
		'[{"name":"Chicken Rice","quantity":1},{"name":"Chicken Briyani","quantity":1},{"name":"Chicken Noodles","quantity":1},{"name":"Butter Naan","quantity":1},{"name":"Roti","quantity":1},{"name":"Chicken Masala","quantity":1},{"name":"Dragon Chicken","quantity":1},{"name":"Saucy Lollipop","quantity":1},{"name":"BBQ Quarter","quantity":1}]'::jsonb,
		CURRENT_TIMESTAMP,
		CURRENT_TIMESTAMP
	FROM "Category" AS category
	WHERE category."name" = 'Family Combo'
	ON CONFLICT ("slug") DO NOTHING;

	IF NOT EXISTS (
		SELECT 1 FROM "Product" AS product
		JOIN "Category" AS category ON category."id" = product."categoryId"
		WHERE product."slug" = 'family-combo-family-combo'
		  AND product."name" = 'Family Combo'
		  AND category."name" = 'Family Combo'
	) THEN
		RAISE EXCEPTION 'Combo product slug family-combo-family-combo conflicts with a different product or category';
	END IF;
END;
$combo_catalog$;