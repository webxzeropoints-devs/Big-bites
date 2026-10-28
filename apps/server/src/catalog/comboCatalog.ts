import { toMinorUnits } from "../utils/currency.js";

export type ComboComponent = {
  name: string;
  quantity: number;
};

export type ComboDefinition = {
  slug: string;
  name: string;
  category: string;
  price: string;
  items: ComboComponent[];
};

export const COMBO_CATALOG: ComboDefinition[] = [
  {
    slug: "couples-friends-combo-couples-friends-combo",
    name: "Couples/Friends Combo",
    category: "Couples/Friends Combo",
    price: "499.00",
    items: [
      { name: "Chicken Rice", quantity: 1 },
      { name: "Chicken Briyani", quantity: 1 },
      { name: "BBQ Quarter", quantity: 1 },
      { name: "Chicken Lollipop", quantity: 1 },
    ],
  },
  {
    slug: "family-combo-family-combo",
    name: "Family Combo",
    category: "Family Combo",
    price: "999.00",
    items: [
      { name: "Chicken Rice", quantity: 1 },
      { name: "Chicken Briyani", quantity: 1 },
      { name: "Chicken Noodles", quantity: 1 },
      { name: "Butter Naan", quantity: 1 },
      { name: "Roti", quantity: 1 },
      { name: "Chicken Masala", quantity: 1 },
      { name: "Dragon Chicken", quantity: 1 },
      { name: "Saucy Lollipop", quantity: 1 },
      { name: "BBQ Quarter", quantity: 1 },
    ],
  },
];

export function getComboDefinition(slug: string): ComboDefinition | undefined {
  return COMBO_CATALOG.find((combo) => combo.slug === slug);
}

export function isComboConfigurationValid(
  slug: string,
  price: unknown,
  comboItems: unknown,
): boolean {
  const definition = getComboDefinition(slug);
  if (!definition) return true;

  try {
    if (
      toMinorUnits(String(price)) !== toMinorUnits(definition.price) ||
      !Array.isArray(comboItems) ||
      comboItems.length !== definition.items.length
    ) {
      return false;
    }

    const normalize = (items: unknown[]) =>
      items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Record<string, unknown>;
          const name = typeof value.name === "string" ? value.name.trim() : "";
          const quantity = Number(value.quantity);
          if (!name || !Number.isInteger(quantity) || quantity <= 0) return null;
          return { name, quantity };
        })
        .sort((left, right) => (left?.name ?? "").localeCompare(right?.name ?? ""));

    const actual = normalize(comboItems);
    const expected = normalize(definition.items);
    return actual.every(
      (item, index) =>
        item !== null &&
        item.name === expected[index]?.name &&
        item.quantity === expected[index]?.quantity,
    );
  } catch {
    return false;
  }
}