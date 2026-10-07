import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Explicit local opt-in; only AI settings can cross into the LAN runtime.
// This file is ignored by Git and is never copied into dist or distribution kits.
export function lanAiConfig(root, environment = process.env) {
  const local = {};
  const file = path.join(root, '.dev.vars.lan-ai');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      local[match[1]] = value;
    }
  }
  const value = (key) => environment[key] ?? local[key];
  if (value('AI_LAN_ENABLED') !== 'true' || !value('OPENROUTER_API_KEY')) return { vars: {}, secrets: {} };
  return {
    vars: {
      AI_LAN_ENABLED: 'true',
      AI_PROVIDER: 'openrouter',
      OPENROUTER_MODEL: value('OPENROUTER_MODEL') || 'nvidia/nemotron-3-super-120b-a12b:free',
    },
    secrets: { OPENROUTER_API_KEY: value('OPENROUTER_API_KEY') },
  };
}
