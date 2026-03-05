const cacheStore = {};

export function getCache(key) {
  const item = cacheStore[key];

  if (!item) return null;

  if (Date.now() > item.expiry) {
    delete cacheStore[key];
    return null;
  }

  return item.value;
}

export function setCache(key, value, ttlSeconds) {
  cacheStore[key] = {
    value,
    expiry: Date.now() + ttlSeconds * 1000,
  };
}
