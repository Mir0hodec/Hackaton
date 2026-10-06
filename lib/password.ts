const encode = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export async function passwordDigest(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return encode(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
        key,
        256,
      ),
    ),
  );
}
export async function credentials(password: string) {
  if (password.length < 8 || password.length > 128)
    throw new Error('Пароль должен содержать от 8 до 128 символов');
  const passwordSalt = crypto.randomUUID();
  return { passwordSalt, passwordHash: await passwordDigest(password, passwordSalt) };
}
export async function verifyPassword(user: any, password: string) {
  if (!user?.passwordSalt || !user.passwordHash || password.length > 128) return false;
  const digest = await passwordDigest(password, user.passwordSalt);
  let diff = digest.length ^ user.passwordHash.length;
  for (let i = 0; i < digest.length; i++)
    diff |= digest.charCodeAt(i) ^ (user.passwordHash.charCodeAt(i) || 0);
  return diff === 0;
}
