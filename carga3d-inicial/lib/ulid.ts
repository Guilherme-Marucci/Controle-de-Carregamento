const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Gera um ULID de 26 caracteres (48 bits de timestamp em ms + 80 bits de entropia criptográfica)
 * 100% compatível com Cloudflare Workers / Edge Runtime.
 */
export function generateUlid(timestampMs: number = Date.now()): string {
  let time = timestampMs;
  let timeChars = '';
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32;
    timeChars = CROCKFORD_BASE32[mod]! + timeChars;
    time = Math.floor(time / 32);
  }

  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  let randomChars = '';
  for (let i = 0; i < 16; i++) {
    randomChars += CROCKFORD_BASE32[randomBytes[i]! & 31]!;
  }

  return timeChars + randomChars;
}

