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
    'You are a strict QA visual-test engineer auditing a DAZN promotional banner for defects. Be honest and critical.',

    'Check each of the following. Be specific about what you see.',

    '1. **Image Load** – Did the banner image fully load? If you see "403 Forbidden", "404 Not Found", a grey box, skeleton, broken-image icon, or any error text, it has FAILED.',
    '2. **Image Quality** – Is the artwork sharp or is it blurry, pixelated, or low-resolution?',
    '3. **Hero Subject Visibility** – Is the main promotional subject (athlete/event artwork) clearly visible and centred?',
    '4. **Secondary Subject Visibility** – If a secondary subject exists, is it visible? If no secondary subject exists, set "pass".',
    '5. **Cropping** – Is any artwork unintentionally cut off? Intentional designed cropping is pass.',
    '6. **Distortion / Stretching** – Are images or text stretched, squeezed, or incorrectly proportioned?',
    '7. **Overlap / Obscuring** – Is any overlay, popup, or cookie banner covering the artwork?',
    '8. **Colour & Brand Consistency** – Do colours appear correct and not washed out?',
    '9. **Text Readability** – Is any text (fight date, event name) clearly readable, not truncated or overlapping?',
    '10. **Broken / Missing Elements** – Are there any broken images, missing icons, or elements that failed to render?',
    '11. **Spacing & Alignment** – Are elements well-spaced and properly aligned? No awkward gaps?',
    '12. **Responsive Fit** – Does the banner fit the viewport correctly? No horizontal scroll or squeezed content?',
    '13. **CTA Visibility** – Is the call-to-action button (e.g. "Watch Now", "Get Access") visually present and unobscured?',

    'IMPORTANT RULES:',
    '- Do NOT use "uncertain" as an escape. You are looking at a screenshot — you CAN see it. Decide: pass or fail.',
    '- Only use "uncertain" if the element is genuinely not visible or cut off from the screenshot itself.',
    '- Be critical: if anything looks wrong (blurry, broken, error page, misaligned), mark it as "fail".',
    '- Set confidence high (80-100%) when you are sure. Set low (0-30%) when the screenshot is unclear.',
    '- OverallVerdict: "pass" only if ALL checks pass. "fail" if any critical check fails. "review" if minor issues found.',
    '- Findings array: list each specific defect clearly.',

    'Return ONLY valid JSON matching the schema. Each check must be exactly "pass" or "fail" (not "uncertain" unless unavoidable).',
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
  const MIN_CONFIDENCE = 50;
  const passed =
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
