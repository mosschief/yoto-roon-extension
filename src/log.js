function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (...args) => console.log(`[${ts()}]`, ...args),
  warn: (...args) => console.warn(`[${ts()}] WARN`, ...args),
  error: (...args) => console.error(`[${ts()}] ERROR`, ...args),
};
