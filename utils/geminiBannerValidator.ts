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
    !assessment.heroSubjectVisible ||
    !assessment.secondarySubjectVisible ||
    !assessment.cropping ||
    !assessment.distortion ||
    !assessment.overlay ||
    typeof assessment.confidence !== 'number' ||
    !Array.isArray(assessment.findings)
) {
    throw new Error('Gemini returned an invalid banner assessment');
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

    imageLoaded: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    imageQuality: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    heroSubjectVisible: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    secondarySubjectVisible: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    cropping: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    distortion: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    overlay: {
      type: 'string',
      enum: ['pass', 'fail', 'uncertain']
    },

    confidence: {
      type: 'number'
    },

    findings: {
      type: 'array',
      items: {
        type: 'string'
      }
    }
  },

  required: [
    'imageLoaded',
    'imageQuality',
    'heroSubjectVisible',
    'secondarySubjectVisible',
    'cropping',
    'distortion',
    'overlay',
    'confidence',
    'findings'
  ]
};
   const prompt = [
  'You are a senior visual QA engineer reviewing a DAZN promotional banner.',

  'Ignore ALL text on the page.',

  'Do NOT validate:',

  '- event title',
  '- date',
  '- price',
  '- CTA buttons',
  '- logos',
  '- plans',

  'Those are validated separately by automation.',

  'Evaluate ONLY the rendered promotional artwork.',

  'Determine whether:',

  '- the banner image has fully loaded',
  '- the artwork is sharp and not blurry',
  '- there is no visible distortion or stretching',
  '- there are no missing image sections',
  '- no placeholder, skeleton or broken image is visible',
  '- the hero promotional subject is clearly visible',
  '- the secondary promotional subject is visible if one exists',
  '- there is no unintended cropping caused by rendering',
  '- no overlay or popup obscures the artwork',

  'Treat intentional marketing artwork cropping as PASS.',

  'Return ONLY valid JSON matching the supplied schema.',

  'Do not explain your reasoning outside the findings array.'
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
    assessment.overlay === 'pass';

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
`${icon} [Gemini Banner] ${
    passed ? 'PASS' : 'WARNING'
} | loaded=${assessment.imageLoaded}` +
` | quality=${assessment.imageQuality}` +
` | hero=${assessment.heroSubjectVisible}` +
` | secondary=${assessment.secondarySubjectVisible}` +
` | crop=${assessment.cropping}` +
` | distortion=${assessment.distortion}` +
` | overlay=${assessment.overlay}` +
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
