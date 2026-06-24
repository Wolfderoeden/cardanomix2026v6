import nodemailer from "nodemailer";

export function isMailerConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function requiresEmailDelivery() {
  return process.env.REQUIRE_EMAIL_DELIVERY === "true" || process.env.NODE_ENV === "production";
}

function buildTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

function formatCurrency(amount, currency = "EUR") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amount);
}

export async function sendOrderNotification(order, user) {
  if (!isMailerConfigured()) {
    return {
      delivered: false,
      status: "not_configured",
      message: "Gmail SMTP is not configured"
    };
  }

  const to = process.env.ORDER_NOTIFY_EMAIL || process.env.GMAIL_USER;
  const itemLines = order.items
    .map((item) => `${item.quantity} x ${item.name} (${formatCurrency(item.unitPriceEur)})`)
    .join("\n");

  const text = [
    `New CardanoMix order ${order.publicId}`,
    "",
    `Customer: ${user.name} <${user.email}>`,
    `Total: ${formatCurrency(order.totalEur)}`,
    `ADA quote: ${order.adaAmount} ADA at ${order.price.symbol} ${order.price.price}`,
    `Binance fetched at: ${order.price.fetchedAt}`,
    "",
    "Items:",
    itemLines
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">
      <h2>New CardanoMix order ${order.publicId}</h2>
      <p><strong>Customer:</strong> ${user.name} &lt;${user.email}&gt;</p>
      <p><strong>Total:</strong> ${formatCurrency(order.totalEur)}</p>
      <p><strong>ADA quote:</strong> ${order.adaAmount} ADA at ${order.price.symbol} ${order.price.price}</p>
      <p><strong>Binance fetched at:</strong> ${order.price.fetchedAt}</p>
      <h3>Items</h3>
      <ul>
        ${order.items.map((item) => `<li>${item.quantity} x ${item.name} (${formatCurrency(item.unitPriceEur)})</li>`).join("")}
      </ul>
    </div>
  `;

  const info = await buildTransporter().sendMail({
    from: `"CardanoMix Orders" <${process.env.GMAIL_USER}>`,
    to,
    subject: `CardanoMix order ${order.publicId}`,
    text,
    html
  });

  return {
    delivered: true,
    status: "sent",
    messageId: info.messageId,
    to
  };
}
