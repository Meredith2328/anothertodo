import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const randomBytes = (length: number) => ({
  toString: (encoding: string) => {
    if (encoding !== 'hex') throw new Error('不支持的编码');
    return bytesToHex(crypto.getRandomValues(new Uint8Array(length)));
  },
});
export const createHash = (algorithm: string) => {
  if (algorithm !== 'sha1') throw new Error('不支持的摘要算法');
  let input = '';
  return {
    update(value: string) { input += value; return this; },
    digest(encoding: string) {
      if (encoding !== 'hex') throw new Error('不支持的编码');
      return bytesToHex(sha1(new TextEncoder().encode(input)));
    },
  };
};
