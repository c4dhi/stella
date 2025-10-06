/**
 * UUID generation with fallback for older browsers
 *
 * crypto.randomUUID() requires:
 * - Safari 15.4+ (iOS 15.4+)
 * - Chrome 92+
 * - Firefox 95+
 *
 * This utility provides a polyfill for older browsers.
 */
export function generateUUID(): string {
  // Use native crypto.randomUUID if available (secure, modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback polyfill for older browsers (iOS < 15.4, Safari < 15.4)
  // Uses Math.random() which is less secure but sufficient for UI state IDs
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
