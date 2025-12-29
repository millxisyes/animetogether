import crypto from 'crypto';
import config from '../config.js';

const PRIVATE_IP_RANGES = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^0\.0\.0\.0/,
    /^::1$/,
    /^fc00:/, // Unique local address IPv6
];

const FORBIDDEN_HOSTS = [
    'localhost',
    'internal',
];

/**
 * Check if a host/IP is private or forbidden
 * @param {string} host 
 * @returns {boolean}
 */
export function isPrivateHost(host) {
    if (!host) return true;

    // Remove port if present
    const hostname = host.split(':')[0];

    if (FORBIDDEN_HOSTS.includes(hostname.toLowerCase())) return true;

    if (PRIVATE_IP_RANGES.some(regex => regex.test(hostname))) return true;

    return false;
}

/**
 * Generate a signature for a URL
 * @param {string} url 
 * @returns {string} HMAC signature
 */
export function signUrl(url) {
    return crypto
        .createHmac('sha256', config.proxySecret)
        .update(url)
        .digest('hex');
}

/**
 * Verify a URL signature
 * @param {string} url 
 * @param {string} signature 
 * @returns {boolean}
 */
export function verifyUrl(url, signature) {
    if (!url || !signature) return false;
    const expected = signUrl(url);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
