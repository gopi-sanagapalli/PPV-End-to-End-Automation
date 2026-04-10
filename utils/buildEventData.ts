import { formatNextPaymentDate } from './dateUtils';

export function buildEventData(json: any, region: string) {
  const regional = json.regions[region];

  if (!regional) {
    throw new Error(`❌ Region not found: ${region}`);
  }

  const eventData: any = {
    ...json.global,
    ...regional,

    // 🔥 NORMALIZED KEYS (CRITICAL FIX)
    eventName: json.PPV_NAME,
    secondaryEventName: json.SECONDARY_PPV,

    PPV_NAME: json.PPV_NAME,
    SECONDARY_PPV: json.SECONDARY_PPV,

    NEXT_PAYMENT_DAYS_OFFSET: json.NEXT_PAYMENT_DAYS_OFFSET
  };

  // 🔥 Derived field
  eventData.NEXT_PAYMENT_DATE = formatNextPaymentDate(
    eventData.NEXT_PAYMENT_DAYS_OFFSET
  );

  return eventData;
}