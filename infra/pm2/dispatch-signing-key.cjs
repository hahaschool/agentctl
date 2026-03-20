const { createHash, createPrivateKey, createPublicKey } = require('node:crypto');

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DISPATCH_SIGNING_NAMESPACE = 'agentctl:dispatch-signing';

function deriveStableDispatchSigningSecretKey(label) {
  if (typeof label !== 'string' || label.length === 0) {
    throw new TypeError('dispatch signing label must be a non-empty string');
  }

  const seed = createHash('sha256')
    .update(`${DISPATCH_SIGNING_NAMESPACE}:${label}`)
    .digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKeyDer = createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });

  if (
    !Buffer.isBuffer(publicKeyDer) ||
    publicKeyDer.length !== ED25519_SPKI_PREFIX.length + 32 ||
    !publicKeyDer.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error('unexpected Ed25519 public key encoding');
  }

  const publicKey = publicKeyDer.subarray(ED25519_SPKI_PREFIX.length);
  return Buffer.concat([seed, publicKey]).toString('base64');
}

module.exports = {
  deriveStableDispatchSigningSecretKey,
};
