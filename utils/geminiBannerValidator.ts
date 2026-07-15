import fs from 'fs';
import https from 'https';
import path from 'path';

type BannerAssessment = {
  imageLoaded: 'pass' | 'fail' | 'uncertain';
  imageQuality: 'pass' | 'fail' | 'uncertain';

  heroSubjectVisible: 'pass' | 'fail' | 'uncertain';
  secondarySubjectVisible: 'pass' | 'fail' | 'uncertain';

  cropping: 'pass' | 'fail' | 'uncertain';
  distortion: 'pass' | 'fail' | 'uncertain';
  overlay: 'pass' | 'fail' | 'uncertain';

  /** New QA fields for comprehensive banner validation */
  colorsMatchBrand: 'pass' | 'fail' | 'uncertain';
  textReadable: 'pass' | 'fail' | 'uncertain';
  noBrokenElements: 'pass' | 'fail' | 'uncertain';
  spacingAligned: 'pass' | 'fail' | 'uncertain';
  responsiveFit: 'pass' | 'fail' | 'uncertain';
  ctaVisible: 'pass' | 'fail' | 'uncertain';

  confidence: number;

  findings: string[];

  /** Human-readable summary of QA judgement */
  overallVerdict: 'pass' | 'fail' | 'review';
};

export type BannerValidationResult = {
  passed: boolean;
  assessment: BannerAssessment;
};

function requestGemini(url: string, apiKey: string, body: Buffer): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Gemini request timed out after 30 seconds')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function parseAssessment(responseBody: string): BannerAssessment {
  const response = JSON.parse(responseBody) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = response.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini returned no text assessment');

  const assessment = JSON.parse(text) as BannerAssessment;
  if (
    !assessment.imageLoaded ||
    !assessment.imageQuality ||
    !assessment.heroSubjectVisible ||
    !assessment.secondarySubjectVisible ||
    !assessment.cropping ||
    !assessment.distortion ||
    !assessment.overlay ||
    !assessment.colorsMatchBrand ||
    !assessment.textReadable ||
    !assessment.noBrokenElements ||
    !assessment.spacingAligned ||
    !assessment.responsiveFit ||
    !assessment.ctaVisible ||
    !assessment.overallVerdict ||
    typeof assessment.confidence !== 'number' ||
    !Array.isArray(assessment.findings)
  ) {
    throw new Error('Gemini returned an invalid or incomplete banner assessment');
  }
  return assessment;
}

/**
 * Checks a rendered promotional banner image. Existing PPV callers use this as
 * supplementary, warn-only QA; standalone callers can assert the result.
 */
export async function validateBannerImage(
  banner: { screenshot(options: { path: string; type: 'png' }): Promise<Buffer> },
  context: { region: string; flow: string; url?: string }
): Promise<BannerValidationResult | null> {
  if (process.env.GITHUB_ACTIONS !== 'true' && process.env.GEMINI_BANNER_VALIDATION !== 'true') return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('ℹ️ [Gemini Banner] GEMINI_API_KEY is not configured; visual check skipped.');
    return null;
  }

  try {
    const evidenceDir = path.resolve(process.cwd(), 'test-results', 'gemini-banner');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeFlow = context.flow.replace(/[^a-zA-Z0-9_-]/g, '-');
    const imagePath = path.join(evidenceDir, `banner-${safeFlow}-${context.region}-${timestamp}.png`);
    await banner.screenshot({ path: imagePath, type: 'png' });

    const image = fs.readFileSync(imagePath).toString('base64');
  const schema = {
    type: 'object',

    properties: {
      imageLoaded: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      imageQuality: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      heroSubjectVisible: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      secondarySubjectVisible: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      cropping: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      distortion: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      overlay: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      colorsMatchBrand: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      textReadable: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      noBrokenElements: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      spacingAligned: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      responsiveFit: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      ctaVisible: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
      confidence: { type: 'number' },
      findings: { type: 'array', items: { type: 'string' } },
      overallVerdict: { type: 'string', enum: ['pass', 'fail', 'review'] }
    },

    required: [
      'imageLoaded', 'imageQuality',
      'heroSubjectVisible', 'secondarySubjectVisible',
      'cropping', 'distortion', 'overlay',
      'colorsMatchBrand', 'textReadable', 'noBrokenElements',
      'spacingAligned', 'responsiveFit', 'ctaVisible',
      'confidence', 'findings', 'overallVerdict'
    ]
  };
  const prompt = [
    'You are an adversarial QA inspector. Your job is to FIND defects in this DAZN banner screenshot. Default assumption: the banner is DEGRADED until proven otherwise.',

    'CRITICAL FIRST CHECK: Is the actual NFL welcome promotional banner artwork visible?',
    'IMMEDIATELY FAIL ALL CHECKS IF:',
    '- You see a modal/popup/dialog (e.g. VPN warning, adblock warning, cookie consent) instead of the banner',
    '- You see a login page, error page, or any page other than the NFL welcome banner',
    '- The banner area contains a placeholder, grey box, or empty space instead of athlete/event artwork',
    '- The page is blocked by a geo/VPN restriction message',
    '',
    'Describe in 1-2 sentences exactly what is visible in the screenshot.',
    '',
    'Then assign pass/fail for each check:',
    '1. imageLoaded — Did the banner fully load? FAIL if: "403"/"404", error text, placeholder, skeleton, VPN modal, or no artwork.',
    '2. imageQuality — Is the artwork sharp? FAIL if: blurry, pixelated, artifacts.',
    '3. heroSubjectVisible — Is the main subject (athlete) visible in the artwork? FAIL if: cut off, partial, not visible.',
    '4. secondarySubjectVisible — FAIL if a second subject is missing but should be there.',
    '5. cropping — Is artwork unintentionally cut? FAIL if players/faces cut at edges.',
    '6. distortion — FAIL if stretched/squeezed/wrong aspect ratio.',
    '7. overlay — FAIL if modal/cookie banner/popup covers the artwork.',
    '8. colorsMatchBrand — FAIL if washed out or wrong colours.',
    '9. textReadable — FAIL if truncated, overlapping, or unclear.',
    '10. noBrokenElements — FAIL if broken images, missing icons.',
    '11. spacingAligned — FAIL if misaligned or awkward gaps.',
    '12. responsiveFit — FAIL if squeezed or empty space.',
    '13. ctaVisible — FAIL if CTA button not visible.',
    '',
    'Findings: REQUIRED. Describe exactly what you see and what defects exist.',
    'overallVerdict: "fail" unless artwork is clearly correct.',
    'confidence: 0-100. Low if defects exist.',

    'Return ONLY valid JSON matching the schema. Do NOT use "uncertain" — force yourself to pick pass or fail.',
  ].join(' ');
    const payload = Buffer.from(JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/png', data: image } },
        { text: prompt },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    }));
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await requestGemini(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      apiKey,
      payload
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Gemini returned HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
    }

    const assessment = parseAssessment(response.body);
  const MIN_CONFIDENCE = 60;
  const hasFindings = Array.isArray(assessment.findings) && assessment.findings.length > 0;
  const passed =
    hasFindings &&
    assessment.overallVerdict === 'pass' &&
    assessment.confidence >= MIN_CONFIDENCE &&
    assessment.imageLoaded === 'pass' &&
    assessment.imageQuality === 'pass' &&
    assessment.heroSubjectVisible === 'pass' &&
    assessment.secondarySubjectVisible === 'pass' &&
    assessment.cropping === 'pass' &&
    assessment.distortion === 'pass' &&
    assessment.overlay === 'pass' &&
    assessment.colorsMatchBrand === 'pass' &&
    assessment.textReadable === 'pass' &&
    assessment.noBrokenElements === 'pass' &&
    assessment.spacingAligned === 'pass' &&
    assessment.responsiveFit === 'pass' &&
    assessment.ctaVisible === 'pass';

const icon = passed ? '✅' : '⚠️';

    fs.writeFileSync(`${imagePath}.json`, `${JSON.stringify({
      url: context.url,
      flow: context.flow,
      region: context.region,
      image: path.basename(imagePath),
      passed,
      assessment,
    }, null, 2)}\n`);

  console.log(
    `${icon} [Gemini Banner] ${passed ? 'PASS' : 'WARN'} | ` +
    `loaded=${assessment.imageLoaded}` +
    ` | quality=${assessment.imageQuality}` +
    ` | hero=${assessment.heroSubjectVisible}` +
    ` | secondary=${assessment.secondarySubjectVisible}` +
    ` | crop=${assessment.cropping}` +
    ` | distortion=${assessment.distortion}` +
    ` | overlay=${assessment.overlay}` +
    ` | colors=${assessment.colorsMatchBrand}` +
    ` | text=${assessment.textReadable}` +
    ` | broken=${assessment.noBrokenElements}` +
    ` | spacing=${assessment.spacingAligned}` +
    ` | responsive=${assessment.responsiveFit}` +
    ` | cta=${assessment.ctaVisible}` +
    ` | verdict=${assessment.overallVerdict}` +
    ` | confidence=${assessment.confidence}%`
  );
    for (const finding of assessment.findings) console.log(`   [Gemini Banner] ${finding}`);
    return { passed, assessment };
  } catch (error: any) {
    // Gemini is supplementary QA; an API/quota/model issue must not hide the E2E result.
    console.warn(`⚠️ [Gemini Banner] Visual check could not run: ${error?.message || error}`);
    return null;
  }
}

// Kept for existing PPV flows, where the result remains warn-only.
export const validatePpvBannerImage = validateBannerImage;
