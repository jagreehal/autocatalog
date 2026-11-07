/** Kong's plugins that authenticate a request, open source and Enterprise. */
export const AUTHENTICATION = new Set([
  'basic-auth',
  'hmac-auth',
  'jwt',
  'key-auth',
  'key-auth-enc',
  'ldap-auth',
  'ldap-auth-advanced',
  'mtls-auth',
  'oauth2',
  'oauth2-introspection',
  'openid-connect',
  'vault-auth',
]);

/**
 * Whether a plugin instance authenticates a request: an authentication plugin,
 * switched on, that does not let an anonymous request through.
 */
export const authenticates = (instance: {
  enabled: boolean;
  config?: { anonymous?: unknown } | undefined;
}) => instance.enabled && !instance.config?.anonymous;
