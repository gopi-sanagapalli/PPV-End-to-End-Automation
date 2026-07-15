import fs from 'fs';
import https from 'https';
import path from 'path';

type BannerAssessment = {
  imageLoaded: 'pass' | 'fail' | 'uncertain';
  imageQuality: 'pass' | 'fail' | 'uncertain';
  fightersVisible: 'pass' | 'fail' | 'uncertain';
  fighterCropping: 'pass' | 'fail' | 'uncertain';
  imageDistortion: 'pass' | 'fail' | 'uncertain';
  overlayObstructingArtwork: 'pass' | 'fail' | 'uncertain';
  confidence: number;
  findings: string[];
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
    !assessment.fightersVisible ||
    !assessment.fighterCropping ||
    !assessment.imageDistortion ||
    !assessment.overlayObstructingArtwork ||
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
        fightersVisible: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        fighterCropping: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        imageDistortion: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        overlayObstructingArtwork: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        confidence: { type: 'number' },
        findings: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'imageLoaded', 'imageQuality', 'fightersVisible',
        'fighterCropping', 'imageDistortion', 'overlayObstructingArtwork',
        'confidence', 'findings'
      ]
    };
    const prompt = [
      'You are a QA visual-test engineer reviewing a DAZN promotional banner screenshot.',

      'CRITICAL: If the screenshot shows a VPN warning modal, error page (403/404), login page, grey placeholder, or anything other than the actual promotional banner artwork, mark ALL checks as "fail".',

      'Evaluate the promotional banner artwork for these checks:',
      '1. imageLoaded — Did the banner image fully load? PASS if real artwork is visible. FAIL if error, placeholder, skeleton, or modal.',
      '2. imageQuality — Is the artwork sharp and clear? FAIL if blurry, pixelated, or low resolution.',
      '3. fightersVisible — Are the fighters/subjects clearly visible in the artwork? FAIL if cut off, partially hidden, or not visible.',
      '4. fighterCropping — CRITICAL: Is any fighter unintentionally cut off at the edges?',
      '   FAIL if: a fighters head/hair/helmet/body is cut off at the top, bottom, left, or right of the banner image.',
      '   FAIL if: part of a fighters face, shoulder, or body is outside the visible frame.',
      '   FAIL if: you can see only half of a fighters body or a fighter is truncated by the edge.',
      '   PASS only if: all fighters are fully within the frame. Intentional artwork/dynamic cropping for effect is still FAIL if it cuts off fighter body parts.',
      '5. imageDistortion — Is the image stretched, squeezed, or wrong aspect ratio? FAIL if distorted.',
      '6. overlayObstructingArtwork — Is a modal, popup, cookie banner, or VPN warning covering the artwork? FAIL if obstructed.',

      'Findings: REQUIRED. List specific observations about what you see. At least 1 finding required.',
      'confidence: 0-100. High (80-100) if artwork looks correct. Low (0-30) if defects found.',

      'Return ONLY valid JSON matching the schema. Do NOT use "uncertain" unless unavoidable.',
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
      assessment.confidence >= MIN_CONFIDENCE &&
      assessment.imageLoaded === 'pass' &&
      assessment.imageQuality === 'pass' &&
      assessment.fightersVisible === 'pass' &&
      assessment.fighterCropping === 'pass' &&
      assessment.imageDistortion === 'pass' &&
      assessment.overlayObstructingArtwork === 'pass';

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
      ` | fighters=${assessment.fightersVisible}` +
      ` | crop=${assessment.fighterCropping}` +
      ` | distortion=${assessment.imageDistortion}` +
      ` | overlay=${assessment.overlayObstructingArtwork}` +
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