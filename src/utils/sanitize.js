/**
 * DAYSTACK Centralized Sanitization Utility
 * Prevents XSS attacks and ensures safe interpolation of user-controlled strings.
 */

/**
 * Escapes unsafe HTML characters in a string.
 * @param {any} str Input value
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Strips potentially dangerous tags and attributes from user text.
 * @param {any} str Input text
 * @returns {string} Sanitized plain text
 */
export function sanitizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Recursively sanitizes all string properties in an object or array.
 * Ideal for imported JSON data validation.
 * @param {any} val Object, array, or primitive
 * @returns {any} Sanitized clone of the input
 */
export function sanitizeObject(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return sanitizeText(val);
  }
  if (Array.isArray(val)) {
    return val.map(item => sanitizeObject(item));
  }
  if (typeof val === 'object') {
    const res = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        // Prevent prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        res[key] = sanitizeObject(val[key]);
      }
    }
    return res;
  }
  return val;
}

// Global browser window fallback
if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.sanitizeText = sanitizeText;
  window.sanitizeObject = sanitizeObject;
}
