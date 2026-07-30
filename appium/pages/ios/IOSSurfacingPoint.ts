import fs from 'fs';
import path from 'path';

export type IOSSurface = 'PPV Banner' | 'PPV Tile';

/**
 * Describes how Safari must re-enter the DAZN web experience after iOS opens
 * the external-website confirmation.  This is deliberately separate from the
 * native source: iOS opens Safari at dazn.com home, not at the native paywall
 * or a reusable checkout URL.
 */
export interface IOSBrowserReentry {
  /** The source to exercise once Safari has loaded DAZN web. */
  webSource: string;
  /** The known entry page after the iOS external-website confirmation. */
  entry: 'safari-home';
  /** False prevents an unverified source from silently taking a wrong route. */
  supported: boolean;
}

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

/**
 * This module is a flow manifest, not a screen/page object.  Native page
 * objects navigate the DAZN app; the WebdriverIO Safari flow asks this
 * resolver how to replay the source after the iOS handoff.
 *
 * Search is intentionally the only enabled web source for now.  The device
 * evidence shows Safari starts at dazn.com home after the Apple confirmation,
 * so every additional source needs a verified Safari navigation before it is
 * enabled here.
 */
export function getIOSBrowserReentry(source: string): IOSBrowserReentry {
  const normalizedSource = (source || '').trim().toLowerCase();

  if (normalizedSource === 'search') {
    return { webSource: 'search', entry: 'safari-home', supported: true };
  }

  return { webSource: normalizedSource, entry: 'safari-home', supported: false };
}

/**
 * Returns the existing Android-named Excel sheet used to validate the native
 * iOS banner/tile.  The workbook is shared intentionally; the name is kept as
 * "Andriod_*" because that is how the existing Excel file is authored.
 */
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
