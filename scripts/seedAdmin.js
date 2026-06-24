import "dotenv/config";
import { hashPassword } from "../server/lib/auth.js";
import { upsertAdminUser } from "../server/lib/store.js";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set before seeding an admin.");
  process.exit(1);
}

if (password.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const admin = await upsertAdminUser({
  email,
  passwordHash: await hashPassword(password)
});

console.log(`Admin ready: ${admin.email}`);
