export const PRODUCTS = [
  {
    id: "ada-bridge-50",
    name: "Bridge Voucher",
    priceUsd: 50,
    tier: "Growth",
    tone: "silver",
    description: "A flexible mid-tier voucher for a measured ADA entry.",
    settlement: "Fast admin routing"
  },
  {
    id: "ada-vault-100",
    name: "Vault Voucher",
    priceUsd: 100,
    tier: "Core",
    tone: "blue",
    description: "Balanced value for recurring ADA buyers.",
    settlement: "Priority tracking"
  },
  {
    id: "ada-arctic-250",
    name: "Arctic Voucher",
    priceUsd: 250,
    tier: "Premium",
    tone: "gold",
    description: "Higher value voucher with enhanced review visibility.",
    settlement: "Admin spotlight"
  }
];

export function findProduct(productId) {
  return PRODUCTS.find((product) => product.id === productId);
}
