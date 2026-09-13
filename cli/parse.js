/**
 * Argument parsing. Deliberately tiny and dependency-free: the engine promises no runtime
 * dependencies, and an argument parser is not where that promise is worth breaking.
 */
import path from 'node:path';

/**
 * Conventional flags, because `docgov --version` is what people type and
 * `docgov version` is what they have to discover. Without this, every
 * `--version` / `--help` lands in the unknown-command path and exits 3, which
 * reads as a broken install.
 */
export const FLAG_ALIASES = {
  '--version': 'version', '-v': 'version', '-V': 'version',
  '--help': 'help', '-h': 'help', '-?': 'help',
};

export function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const key = k.replace(/-/g, '_');
      if (v !== undefined) out[key] = v;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) out[key] = args[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export function list(v) { return v == null || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean); }
