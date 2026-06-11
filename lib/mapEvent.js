/* eslint-disable */
// Mapping d'un payload (webhook systeme.io ou générique) vers un événement
// normalisé. Partagé par /api/ingest (temps réel) et /api/reprocess (rejeu).

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const toISODate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
};
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; }
  }
  return undefined;
}
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
}
function classify(type) {
  const t = String(type || "").toLowerCase();
  if (/(fail|échou|echou|declin|refus|unpaid|impay)/.test(t)) return "failed";
  if (/(cancel|annul|refund|rembours|chargeback)/.test(t)) return "cancelled";
  return "paid";
}

function mapEvent(body) {
  body = body || {};
  const data = body.data || body.payload || body;

  if (body.customer || body.order || body.pricePlan || body.subscription || deepEmail(body)) {
    // --- webhook systeme.io ---
    const cust = body.customer || {};
    const order = body.order || {};
    const plan = body.pricePlan || {};
    const step = body.funnelStep || {};
    const item = body.orderItem || {};
    const rec = plan.recurringOptions || {};
    const f = cust.fields || {};
    const email = String(cust.email || deepEmail(body) || "").toLowerCase();
    const name = [pick(f, "first_name", "firstName"), pick(f, "last_name", "surname", "lastName")]
      .filter(Boolean).join(" ").trim() ||
      deepFind(body, ["first_name", "firstName", "fullName", "name"]) || email || "Client";
    const cents = order.totalPrice != null ? order.totalPrice
      : (plan.amount != null ? plan.amount
        : deepFind(body, ["totalPrice", "total_price", "amountPaid", "amount", "total", "price"]));
    const refund = !!body.refund || /refund|rembours|cancel|annul/i.test(String(body.type || body.event || ""));
    return {
      id: "tx-" + (item.id || order.id || deepFind(body, ["id", "transactionId", "paymentId", "orderId"]) || `${email}-${Date.now()}`),
      email,
      name,
      amount: num(cents) / 100,
      date: toISODate(order.createdAt || item.createdAt || deepFind(body, ["createdAt", "created_at", "paidAt", "date"])) || toISODate(Date.now()),
      offer: step.name || plan.innerName || plan.name || deepFind(body, ["innerName", "productName", "funnelName"]) || "",
      type: plan.type || "sale",
      status: refund ? "cancelled" : "paid",
      planAmount: plan.amount != null ? num(plan.amount) / 100 : null,
      planCount: rec.limitOfPayments || deepFind(body, ["limitOfPayments"]) || null,
      planInterval: rec.interval || null,
      processor: cust.paymentProcessor || "stripe",
      receivedAt: new Date().toISOString(),
    };
  }

  // --- repli générique ---
  const contact = data.contact || data.customer || body.contact || {};
  const email = String(pick(contact, "email") || pick(data, "email", "customerEmail") || "").toLowerCase();
  const name = [pick(contact, "firstName", "first_name"), pick(contact, "surname", "lastName", "last_name")]
    .filter(Boolean).join(" ").trim() || pick(data, "customerName", "name") || email || "Client";
  const amount = num(pick(data, "amount", "total", "price", "amountPaid", "value"));
  const date = toISODate(pick(data, "date", "createdAt", "created_at", "paidAt", "paymentDate")) || toISODate(Date.now());
  const offer = pick(data, "offer", "productName", "product", "funnelName", "planName", "name") || "";
  const type = pick(body, "type", "event", "eventType", "trigger") || pick(data, "type", "event") || "";
  return {
    id: String(pick(data, "id", "transactionId", "invoiceId", "paymentId", "orderId") || `${email}-${date}-${amount}-${Math.random().toString(36).slice(2, 7)}`),
    email, name, amount, date, offer, type, status: classify(type), receivedAt: new Date().toISOString(),
  };
}

module.exports = { mapEvent };
