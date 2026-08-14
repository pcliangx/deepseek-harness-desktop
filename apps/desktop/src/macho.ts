/**
 * Mach-O magic detection for pre-signing the staged CLI tree: only true
 * Mach-O images need a code signature; resource files are covered by the
 * outer app-bundle seal.
 * @module @deepseek-ai/dsh-desktop/macho
 */

/** Mach-O magics in canonical numeric form: 64-bit, 32-bit, and fat image. */
const MACH_O_MAGICS = new Set([0xfeedfacf, 0xfeedface, 0xcafebabe])

/**
 * @param header - the first bytes of a file; at least 4 are needed for a verdict.
 * @returns whether the header is a Mach-O or fat-image magic in either byte order.
 */
export function isMachO(header: Buffer): boolean {
  if (header.length < 4) return false
  return MACH_O_MAGICS.has(header.readUInt32BE(0)) || MACH_O_MAGICS.has(header.readUInt32LE(0))
}
