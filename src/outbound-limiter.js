const PER_HOUR = 8;
const PER_DAY = 20;

const _buckets = new Map();

function _bucket(phone) {
  if (!_buckets.has(phone)) {
    const now = Date.now();
    _buckets.set(phone, {
      hour: { count: 0, reset: now + 3_600_000 },
      day:  { count: 0, reset: now + 86_400_000 },
    });
  }
  return _buckets.get(phone);
}

function canSend(phone) {
  const now = Date.now();
  const b = _bucket(phone);
  if (now > b.hour.reset) { b.hour.count = 0; b.hour.reset = now + 3_600_000; }
  if (now > b.day.reset)  { b.day.count = 0;  b.day.reset  = now + 86_400_000; }
  b.hour.count++;
  b.day.count++;
  if (b.hour.count > PER_HOUR) return { allowed: false, reason: 'outbound_hour' };
  if (b.day.count > PER_DAY)   return { allowed: false, reason: 'outbound_day' };
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, b] of _buckets) {
    if (now > b.day.reset) _buckets.delete(phone);
  }
}, 3_600_000);

module.exports = { canSend, PER_HOUR, PER_DAY };
