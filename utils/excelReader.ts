import * as XLSX from 'xlsx';

// =========================
// CONFIG
// =========================
const FILE_PATH = 'data/PPV_Input.xlsx';

// =========================
// READ SHEET
// =========================
export const readSheet = (sheetName: string) => {
  const workbook = XLSX.readFile(FILE_PATH);
  const sheet    = workbook.Sheets[sheetName];

  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new Error(
      `❌ Sheet not found: "${sheetName}"\n` +
      `   Available sheets: ${available}`
    );
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

  if (!rawData.length) {
    throw new Error(`❌ Sheet is empty: "${sheetName}"`);
  }

  return rawData;
};

// =========================
// LANDING DATA
// =========================
export const getLandingData = () => {
  const data = readSheet('Landing page');

  const result: Record<string, any> = {};

  data.forEach((row: any) => {
    const field = row.Field?.toString().trim();
    const value = row.Expected;

    if (!field) {
      throw new Error(`❌ Missing 'Field' in Landing page row`);
    }

    result[field] = value;
  });

  console.log('📊 Landing Data:', result);
  return result;
};

// =========================
// PPV DATA BY VARIANT
// =========================
export const getPPVDataByVariant = (variant: string) => {
  const data = readSheet('PPV page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  if (data.length > 0 && !('Variant' in data[0])) {
    throw new Error(`❌ Missing 'Variant' column in PPV page sheet`);
  }

  const variantData = data.filter(
    (d: any) => normalize(d.Variant) === normalize(variant)
  );

  if (!variantData.length) {
    const available = [...new Set(data.map((d: any) => d.Variant))].join(', ');
    throw new Error(
      `❌ No data found for variant: "${variant}"\n` +
      `   Available variants: ${available}`
    );
  }

  console.log(`🧠 Variant: ${variant}`);
  console.log(`📊 FINAL DATA: ${variantData.length} rows`);

  return variantData;
};

// =========================
// PLAN DATA BY TIER
// =========================
export const getPlanDataByTier = (tier: string) => {
  const data = readSheet('Dazn Plan page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  if (data.length > 0 && !('Tier' in data[0])) {
    throw new Error(`❌ Missing 'Tier' column in Dazn Plan page sheet`);
  }

  const tierData = data.filter(
    (d: any) => normalize(d.Tier) === normalize(tier)
  );

  if (!tierData.length) {
    const available = [...new Set(
      data
        .map((d: any) => d.Tier)
        .filter(Boolean)
    )].join(', ');
    throw new Error(
      `❌ No data found for tier: "${tier}"\n` +
      `   Available tiers: ${available}`
    );
  }

  console.log(`💎 Tier     : ${tier}`);
  console.log(`📊 Plan rows: ${tierData.length}`);

  return tierData;
};

// =========================
// PAYMENT DATA BY TIER & RATE PLAN
// =========================
export const getPaymentDataByTierAndPlan = (
  tier:     string,
  ratePlan: string
) => {
  const data = readSheet('Payment page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  if (data.length > 0 && !('Tier' in data[0])) {
    throw new Error(`❌ Missing 'Tier' column in Payment page sheet`);
  }
  if (data.length > 0 && !('Rate Plan' in data[0])) {
    throw new Error(`❌ Missing 'Rate Plan' column in Payment page sheet`);
  }

  const commonData = data.filter(
    (d: any) =>
      normalize(d.Tier)        === 'common' &&
      normalize(d['Rate Plan']) === 'all'
  );

  const tierPlanData = data.filter(
    (d: any) =>
      normalize(d.Tier)        === normalize(tier) &&
      normalize(d['Rate Plan']) === normalize(ratePlan)
  );

  if (!tierPlanData.length) {
    const available = [
      ...new Set(
        data
          .filter((d: any) => d.Tier && d['Rate Plan'])
          .map((d: any) => `${d.Tier} - ${d['Rate Plan']}`)
      ),
    ].join(', ');
    throw new Error(
      `❌ No data found for tier: "${tier}" + rate plan: "${ratePlan}"\n` +
      `   Available combinations: ${available}`
    );
  }

  const combined = [...commonData, ...tierPlanData];

  console.log(`💎 Tier          : ${tier}`);
  console.log(`📋 Rate Plan     : ${ratePlan}`);
  console.log(`📊 Common rows   : ${commonData.length}`);
  console.log(`📊 Specific rows : ${tierPlanData.length}`);
  console.log(`📊 Total rows    : ${combined.length}`);

  return combined;
};

// =========================
// MY ACCOUNT DATA
// =========================
export const getMyAccountData = () => {
  const data = readSheet('My Account page');
  console.log(`📊 My Account rows: ${data.length}`);
  return data;
};

// =========================
// CHOOSE HOW TO BUY DATA
// =========================
export const getChooseHowToBuyData = () => {
  const data = readSheet('Choose How To Buy page');
  console.log(`📊 Choose How To Buy rows: ${data.length}`);
  return data;
};

// =========================
// PPV PAYMENT DATA
// =========================
export const getPPVPaymentData = () => {
  const data = readSheet('PPV Payment page');
  console.log(`📊 PPV Payment rows: ${data.length}`);
  return data;
};

// =========================
// UPGRADE CONFIRMATION DATA BY RATE PLAN
// =========================
export const getUpgradeConfirmationData = (ratePlan: string) => {
  const data = readSheet('Upgrade Confirmation page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  // ── Always include common rows ─────────────────────────────
  const commonData = data.filter(
    (d: any) => normalize(d.Tier) === 'common'
  );

  // ── Filter by rate plan ────────────────────────────────────
  const ratePlanData = data.filter(
    (d: any) => normalize(d.Tier) === normalize(ratePlan)
  );

  if (!ratePlanData.length) {
    const available = [...new Set(
      data
        .map((d: any) => d.Tier)
        .filter(Boolean)
    )].join(', ');
    throw new Error(
      `❌ No data found for rate plan: "${ratePlan}"\n` +
      `   Available: ${available}`
    );
  }

  const combined = [...commonData, ...ratePlanData];

  console.log(`📋 Rate Plan              : ${ratePlan}`);
  console.log(`📊 Common rows            : ${commonData.length}`);
  console.log(`📊 Rate Plan rows         : ${ratePlanData.length}`);
  console.log(`📊 Total rows             : ${combined.length}`);

  return combined;
};