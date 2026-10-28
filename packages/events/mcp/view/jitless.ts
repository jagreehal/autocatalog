// Hosts frame the view under a CSP without eval, so zod must not compile its
// parsers. zod reads this object when it loads, so it is set before zod is.
Object.assign(globalThis, { __zod_globalConfig: { jitless: true } });
