import * as fs from 'fs';
import * as path from 'path';

export async function loadEventConfig(
  configFile: string,
  region: string
): Promise<Record<string, any>> {

  // 1 Load base config
  const basePath = path.resolve(
    'config/Wardley PPV config/Wardley_base.json'
  );
  const base = JSON.parse(fs.readFileSync(basePath, 'utf-8'));

  // 2 Load flow config
  const flowPath = path.resolve(`config/${configFile}`);

  if (!fs.existsSync(flowPath)) {
    throw new Error(`Config file not found: ${flowPath}`);
  }

  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));

  // 3 Deep merge flow overrides base
  const merged = deepMerge(base, flow);

  // 4 Validate region exists
  if (!merged.regions?.[region]) {
    const available = Object.keys(merged.regions ?? {}).join(', ');
    throw new Error(
      `Region "${region}" not found in ${configFile}\n` +
      `Available regions: ${available}`
    );
  }

  // 5 Flatten all layers
  const globalData = merged.global ?? {};
  const regionData = merged.regions[region];
  const pageData   = regionData.pages ?? merged.pages ?? {};

  const eventData = {
    ...globalData,
    ...merged,
    ...regionData,
    pages: pageData,
    REGION: region
  };

  // 6 Clean up nested objects
  delete eventData.regions;
  delete eventData.global;

  // 7 Resolve PPV_NAME placeholders
  return resolvePlaceholders(eventData);
}

function deepMerge(base: any, override: any): any {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] !== undefined &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function resolvePlaceholders(
  data: Record<string, any>
): Record<string, any> {
  const resolved = { ...data };
  for (const key of Object.keys(resolved)) {
    if (typeof resolved[key] === 'string') {
      resolved[key] = resolved[key].replace(
        /\{\{(\w+)\}\}/g,
        (_, k) => resolved[k] ?? `{{${k}}}`
      );
    }
  }
  return resolved;
}
