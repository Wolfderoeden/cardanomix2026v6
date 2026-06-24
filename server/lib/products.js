export const PRODUCTS = [
  {
    id: "ada-signal-25",
    name: "Signal Voucher",
    priceEur: 25,
    tier: "Starter",
    tone: "teal",
    description: "A clean entry voucher for a first ADA allocation.",
    settlement: "Instant order alert"
  },
  {
    id: "ada-vault-100",
    name: "Vault Voucher",
    priceEur: 100,
    tier: "Core",
    tone: "blue",
    description: "Balanced value for recurring ADA buyers.",
    settlement: "Priority tracking"
  },
  {
    id: "ada-arctic-250",
    name: "Arctic Voucher",
    priceEur: 250,
    tier: "Premium",
    tone: "gold",
    description: "Higher value voucher with enhanced review visibility.",
    settlement: "Admin spotlight"
  }
];

export function findProduct(productId) {
  return PRODUCTS.find((product) => product.id === productId);
}
