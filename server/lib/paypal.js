const PAYPAL_ENDPOINTS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com"
};

function paypalEnv(options = {}) {
  return String(options.paypalEnv || process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";
}

function paypalBaseUrl(options = {}) {
  return options.baseUrl || process.env.PAYPAL_API_BASE || PAYPAL_ENDPOINTS[paypalEnv(options)];
}

export function paypalConfigured(options = {}) {
  return Boolean((options.clientId || process.env.PAYPAL_CLIENT_ID) && (options.clientSecret || process.env.PAYPAL_CLIENT_SECRET));
}

async function getAccessToken(options = {}) {
  const clientId = options.clientId || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = options.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error("PayPal API credentials are not configured");
    error.status = 503;
    throw error;
  }

  const response = await fetch(new URL("/v1/oauth2/token", paypalBaseUrl(options)), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    const error = new Error(`PayPal token request failed with ${response.status}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  return payload.access_token;
}

export async function createPayPalOrder({ publicId, totalUsd, description, returnUrl, cancelUrl, credentials = {} }) {
  const amount = Number(totalUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("PayPal order amount is invalid");
    error.status = 400;
    throw error;
  }

  const accessToken = await getAccessToken(credentials);
  const response = await fetch(new URL("/v2/checkout/orders", paypalBaseUrl(credentials)), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: publicId,
          description: String(description || "CardanoMix ADA order").slice(0, 127),
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2)
          }
        }
      ],
      application_context: {
        brand_name: "CardanoMix",
        landing_page: "BILLING",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl
      }
    })
  });

  if (!response.ok) {
    const error = new Error(`PayPal order request failed with ${response.status}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  const approvalUrl = payload.links?.find((link) => link.rel === "approve")?.href || null;
  return {
    id: payload.id,
    status: payload.status,
    approvalUrl
  };
}

export async function getPayPalOrder({ paypalOrderId, credentials = {} }) {
  if (!paypalOrderId) {
    const error = new Error("PayPal order id is required");
    error.status = 400;
    throw error;
  }

  const accessToken = await getAccessToken(credentials);
  const response = await fetch(new URL(`/v2/checkout/orders/${paypalOrderId}`, paypalBaseUrl(credentials)), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`PayPal order status request failed with ${response.status}`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  return {
    id: payload.id,
    status: payload.status,
    payerEmail: payload.payer?.email_address || null,
    updatedAt: payload.update_time || new Date().toISOString()
  };
}
