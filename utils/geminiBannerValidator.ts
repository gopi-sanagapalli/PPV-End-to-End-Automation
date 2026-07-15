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
    'You are an expert senior QA visual-test engineer. Review the DAZN promotional banner screenshot below and give a thorough, human-quality assessment.',

    'Evaluate ALL of the following aspects as if you were a QA tester manually verifying the banner:',

    '1. **Image Load** – Has the banner image fully loaded? Is there any skeleton, placeholder, grey box, broken-image icon, or text like "403 Forbidden" / "404 Not Found"?',
    '2. **Image Quality** – Is the artwork sharp and crisp, or is it blurry, pixelated, or low-resolution?',
    '3. **Hero Subject Visibility** – Is the main promotional subject (e.g. the athlete/event artwork) clearly visible and centred?',
    '4. **Secondary Subject Visibility** – If a secondary subject exists, is it visible too? If there is no secondary subject, set to "pass".',
    '5. **Cropping** – Is any part of the artwork unintentionally cut off at the edges? Intentional, designed cropping is fine — mark as "pass".',
    '6. **Distortion / Stretching** – Do the images and text look stretched, squeezed, or incorrectly proportioned?',
    '7. **Overlap / Obscuring** – Is any overlay, popup, cookie banner, or other UI element obscuring the promotional artwork?',
    '8. **Colour & Brand Consistency** – Do the colours match DAZN\'s expected brand palette? Are they vibrant or washed out? No colour mismatch?',
    '9. **Text Readability** – Is any text on the artwork (e.g. fight date, event name) clearly readable, not truncated or overlapping?',
    '10. **Broken / Missing Elements** – Are there any broken images, missing icons, or elements that failed to render?',
    '11. **Spacing & Alignment** – Are the promotional elements well-spaced and properly aligned? No awkward gaps or misalignment?',
    '12. **Responsive Fit** – Does the banner look correctly fitted to the viewport? No horizontal scroll, no content squeezed into a corner?',
    '13. **CTA Visibility** – Is the call-to-action button (e.g. "Watch Now", "Get Access") visible and unobscured? Do not validate the CTA text content, only its visual presence and rendering.',

    'Ignore the rest of the page outside the promotional banner area.',
    'Do NOT validate event title, date, price, or plan details — those are checked by separate automated tests.',

    'Use your best judgement like a real QA engineer. If you cannot determine a particular check, set it to "uncertain".',

    'Return ONLY valid JSON conforming to the supplied schema. Each check must be exactly "pass", "fail", or "uncertain". The "findings" array must contain specific, actionable descriptions of any defects found. Supply an "overallVerdict" of "pass", "fail", or "review".',
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
  const passed =
    assessment.imageLoaded === 'pass' &&
    assessment.imageQuality === 'pass' &&
    assessment.heroSubjectVisible === 'pass' &&
    assessment.secondarySubjectVisible !== 'fail' &&
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
