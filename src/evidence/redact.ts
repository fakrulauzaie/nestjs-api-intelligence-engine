const SECRET_ASSIGNMENT =
  /(\b(?:api[_-]?key|secret|password|passwd|token|authorization)\b\s*[:=]\s*)(["'`])[^\r\n]*?\2/gi;
const SECRET_COMPARISON =
  /(\b(?:api[_-]?key|secret|password|passwd|token|authorization)\b\s*(?:===?|!==?)\s*)(["'`])[^\r\n]*?\2/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+(@)/gi;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactSecrets(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]$2')
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(SECRET_COMPARISON, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}[REDACTED]${quote}`;
    })
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}[REDACTED]${quote}`;
    });
}
