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

    'FIRST: Describe in 1-2 sentences exactly what part of the page is visible in the screenshot. Be specific about what you see — error text, players, artwork, background, etc.',

    'THEN: Assign pass/fail for each check below. You MUST be honest and critical. If ANYTHING looks wrong (blurry, cropped, low quality, distorted, bad colours, missing parts, broken elements), mark it FAIL.',

    'Checks:',
    '1. imageLoaded — Did the banner fully load? FAIL if: you see "403", "404", error text, grey/white placeholder, broken image icon, skeleton. PASS only if real artwork is visible.',
    '2. imageQuality — Is the artwork sharp? FAIL if: blurry, pixelated, low resolution, artifacts, grainy.',
    '3. heroSubjectVisible — Is the main subject (e.g. athlete) clearly visible? FAIL if: cut off, partially hidden, too small, or not visible.',
    '4. secondarySubjectVisible — Is a secondary subject (like opponent) visible? FAIL only if a second subject clearly should be there but is missing.',
    '5. cropping — Is artwork unintentionally cut? FAIL if: players/faces/important content are cut off at edges. PASS if cropping is intentional/designed.',
    '6. distortion — Are images/text stretched/squeezed/wrong aspect ratio? FAIL if distorted.',
    '7. overlay — Is a cookie banner, popup, or UI element covering the artwork? FAIL if obscured.',
    '8. colorsMatchBrand — Do colours look correct (DAZN dark/navy palette)? FAIL if: washed out, wrong colours, looks like a placeholder/default.',
    '9. textReadable — Is text on the artwork readable? FAIL if: truncated, overlapping, too small to read, or missing.',
    '10. noBrokenElements — Any broken images, missing icons, empty spaces where content should be? FAIL if broken.',
    '11. spacingAligned — Are elements well-spaced? FAIL if: misaligned, awkward gaps, crammed.',
    '12. responsiveFit — Does the banner fit the viewport? FAIL if: content squeezed to one side, horizontal scroll, empty space.',
    '13. ctaVisible — Is the CTA button (e.g. "Watch Now") visible and unobscured? FAIL if: not visible or partially covered.',

    'FATAL DEFAULTS — if ANY of these are true, mark ALL 13 checks as "fail":',
    '- Error page (403, 404, 500) is visible',
    '- Only a grey/white background with no artwork',
    '- Banner area is completely blank',

    'Findings: REQUIRED. You MUST list at least 1 specific finding describing what is wrong or what you see. If the banner looks perfect, still describe what you see ("Banner shows NFL artwork with players visible, sharp quality"). Empty findings array is NOT ALLOWED.',

    'overallVerdict: "pass" only if artwork is clearly correct and high quality. "fail" if ANY single check is fail. "review" if borderline.',

    'confidence: 0-100. 90-100 only if banner is pristine. 0-30 if there are clear defects.',

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
