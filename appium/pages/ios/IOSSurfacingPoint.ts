import fs from 'fs';
import path from 'path';

export type IOSSurface = 'PPV Banner' | 'PPV Tile';

export interface IOSSurfacingPointConfig {
  source: string;
  page: string;
  endPage: string;
  surface?: IOSSurface;
  validationSheet?: string;
  supportedUserTypes?: string[];
  defaultSignup?: boolean;
  copyUrlFromPaywall?: boolean;
}

export type IOSSurfacingPointMap = Record<string, IOSSurfacingPointConfig>;

let cachedConfig: IOSSurfacingPointMap | null = null;

export function loadIOSSurfacingPoints(): IOSSurfacingPointMap {
  if (cachedConfig) return cachedConfig;

  const configPath = path.resolve(__dirname, '../../config/surfacingpoint.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  cachedConfig = JSON.parse(raw);
  return cachedConfig as IOSSurfacingPointMap;
}

export function getIOSSurfacingPoint(source: string): IOSSurfacingPointConfig {
  const normalizedSource = (source || '').trim().toLowerCase();
  const config = loadIOSSurfacingPoints()[normalizedSource];
  if (config) return config;

  return {
    source: normalizedSource,
    page: 'fallback',
    endPage: 'payment',
  };
}

export function getIOSValidationSheet(source: string, surface: IOSSurface): string {
  const normalizedSource = (source || '').trim().toLowerCase();
  const config = getIOSSurfacingPoint(source);

  // The excel sheets are named 'Andriod_...' (with spelling deviation).
  // We use the same sheets for validation on iOS to reuse the existing test data.
  if (surface === 'PPV Banner') {
    if (normalizedSource === 'landing-page-banner') return 'Andriod_Landing_Page';
    if (normalizedSource === 'home-page-banner') return 'Andriod_Home_Page';
    if (normalizedSource === 'home-boxing-banner') return 'Andriod_Home_Boxing_Page';
  }
  if (surface === 'PPV Tile') {
    if (normalizedSource === 'home-boxing-upcoming' || normalizedSource === 'home-boxing-tile') return 'Andriod_Home_Boxing_Page';
    if (normalizedSource === 'schedule') return 'Andriod_Schedule_Page';
    if (normalizedSource === 'search') return 'Andriod_Search_Page';
    if (normalizedSource === 'home-page-tile' || normalizedSource === 'home-page-dont-miss') return 'Andriod_Home_Page';
  }

  if (config.surface === surface && config.validationSheet) {
    return config.validationSheet;
  }
  
  return '';
}
