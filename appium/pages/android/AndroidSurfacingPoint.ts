import fs from 'fs';
import path from 'path';

export type AndroidSurface = 'PPV Banner' | 'PPV Tile';

export interface AndroidSurfacingPointConfig {
  source: string;
  page: string;
  endPage: string;
  surface?: AndroidSurface;
  validationSheet?: string;
  supportedUserTypes?: string[];
  defaultSignup?: boolean;
  copyUrlFromPaywall?: boolean;
}

export type AndroidSurfacingPointMap = Record<string, AndroidSurfacingPointConfig>;

let cachedConfig: AndroidSurfacingPointMap | null = null;

export function loadAndroidSurfacingPoints(): AndroidSurfacingPointMap {
  if (cachedConfig) return cachedConfig;

  const configPath = path.resolve(__dirname, '../../config/surfacingpoint.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
}

export function getAndroidSurfacingPoint(source: string): AndroidSurfacingPointConfig {
  const normalizedSource = (source || '').trim().toLowerCase();
  const config = loadAndroidSurfacingPoints()[normalizedSource];
  if (config) return config;

  return {
    source: normalizedSource,
    page: 'fallback',
    endPage: 'payment',
  };
}

export function getAndroidValidationSheet(source: string, surface: AndroidSurface): string {
  const config = getAndroidSurfacingPoint(source);
  if (config.surface === surface && config.validationSheet) {
    return config.validationSheet;
  }
  return '';
}
