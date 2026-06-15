import fs from 'fs';
import path from 'path';

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

function resolveEventKey(input?: string): string {
  if (!input) return process.env.PPV_EVENT || 'beauty_and_beast';
  const name = path.basename(input, '.json').toLowerCase();
  if (name.includes('beauty') || name.includes('bnb')) return 'beauty_and_beast';
  if (name.includes('standalone') || name.includes('collision')) return 'standalone_collision';
  if (name.includes('upsell')) return 'upsell_flow';
  if (name.includes('joshua') || name.includes('prenga') || name.includes('aj_')) return 'aj_joshua_prenga';
  return name;
}

function alignRegions(data: any) {
  if (!data || !data.regions) return;
  const gb = data.regions.GB;
  const uk = data.regions.UK;
  // Backward-compat: if an old config only has UK, copy it to GB
  if (uk && !gb) {
    data.regions.GB = deepMerge({}, uk);
  }
  // Clean up: remove UK key entirely so only GB is used
  if (data.regions.UK) {
    delete data.regions.UK;
  }
}

export function loadEventConfig(eventConfigOrKey?: string, planKeyOverride?: string): Record<string, any> {
  // Prioritize environment variables over spec file default arguments:
  // 1. PPV_CONFIG (explicit config file path)
  // 2. PPV_EVENT (explicit event name)
  // 3. Fallback to argument passed by the spec file (eventConfigOrKey)
  // 4. Ultimate fallback to 'beauty_and_beast'
  const configSource = process.env.PPV_CONFIG || process.env.PPV_EVENT || eventConfigOrKey;
  const eventKey = resolveEventKey(configSource);
  const planKey = planKeyOverride || process.env.PLAN || 'standard_monthly';

  const configDir = path.resolve(process.cwd(), 'config');
  const eventsPath = path.join(configDir, 'ppv.json');
  const plansPath = path.join(configDir, 'DaznPlan.json');

  if (!fs.existsSync(eventsPath)) throw new Error(`ppv.json not found in ${configDir}`);
  if (!fs.existsSync(plansPath)) throw new Error(`DaznPlan.json not found in ${configDir}`);

  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
  const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));

  const eventData = events[eventKey];
  const planData = plans[planKey];

  if (!eventData) throw new Error(`Event "${eventKey}" not found in ppv.json`);
  if (!planData) throw new Error(`Plan "${planKey}" not found in DaznPlan.json`);

  // Try to load direct file override if exists
  let fileData: any = {};
  const fileSource = process.env.PPV_CONFIG || (!process.env.PPV_EVENT ? eventConfigOrKey : undefined);
  if (fileSource) {
    let filePath = '';
    if (fs.existsSync(fileSource)) {
      filePath = fileSource;
    } else {
      const relPath = path.resolve(process.cwd(), 'config', fileSource);
      if (fs.existsSync(relPath)) {
        filePath = relPath;
      }
    }
    if (filePath) {
      try {
        fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        console.log(`📄 Loaded custom configuration file override: ${filePath}`);
      } catch (err: any) {
        console.warn(`⚠️  Failed to parse custom config file ${filePath}:`, err.message);
      }
    }
  }

  // Align UK/GB regions across all layers before merging to prevent standard plan's regions
  // from overriding event-specific/file-specific custom overrides (e.g. GB vs UK mismatch)
  alignRegions(planData);
  alignRegions(eventData);
  alignRegions(fileData);

  let merged = deepMerge(planData, eventData);
  merged = deepMerge(merged, fileData);

  merged.eventKey = eventKey;
  merged.planKey = planKey;

  return merged;
}

