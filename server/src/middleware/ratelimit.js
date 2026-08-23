// ── Хэрэглэгч тус бүрийн rate limit (auth-ийн ДАРАА ашиглана) ───────────────
// express-rate-limit IP-ээр ажилладаг; интернэт кафед олон хүн нэг IP-тэй тул
// нэвтэрсэн үйлдлүүдийг (бот хост хүсэлт, захиалга, дүн, найзын хүсэлт) user id-ээр тоолно.
// Санах ойд sliding window; 1000 хэрэглэгч × хэдэн key = хэдэн зуун КБ — Railway-д хангалттай.
const buckets = new Map();   // `${name}:${userId}` -> [timestamps]
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [k, arr] of buckets) {
    if (!arr.length || now - arr[arr.length - 1] > 60 * 60 * 1000) buckets.delete(k);
  }
}

/**
 * perUser('bot-host', 10, 10 * 60 * 1000) → middleware: windowMs дотор max удаа; дараа нь 429.
 * Хэрэглэгч тодорхойгүй бол (auth-гүй зам) IP-ээр тоолно.
 */
function perUser(name, max, windowMs, message) {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now);
    const id = req.user?.id != null ? `u${req.user.id}` : `ip${req.ip}`;
    const key = `${name}:${id}`;
    const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: message || `Хэт олон хүсэлт — ${Math.ceil(retry / 60)} минутын дараа дахин оролдоно уу.`, retry_after: retry });
    }
    arr.push(now);
    buckets.set(key, arr);
    next();
  };
}

function _reset() { buckets.clear(); }

module.exports = { perUser, _reset };
