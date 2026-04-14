import { formatNextPaymentDate } from './dateUtils';

export function buildEventData(json: any, region: string) {
  const regional = json.regions[region];

  if (!regional) {
    throw new Error(`❌ Region not found: ${region}`);
  }

  const eventData: any = {
    ...json.global,
    ...regional,

    PPV_NAME: json.PPV_NAME,
    SECONDARY_PPV: json.SECONDARY_PPV,

    NEXT_PAYMENT_DAYS_OFFSET: json.NEXT_PAYMENT_DAYS_OFFSET
  };

  // 🔥 DERIVED FIELDS
  eventData.NEXT_PAYMENT_DATE = formatNextPaymentDate(
    eventData.NEXT_PAYMENT_DAYS_OFFSET
  );

  eventData.PPV_PRICE_DISPLAY = `${eventData.CURRENCY}${eventData.PPV_PRICE}`;

  // 🔥 NORMALIZE KEYS
  Object.keys(eventData).forEach(key => {
    const upperKey = key.toUpperCase();
    if (!eventData[upperKey]) {
      eventData[upperKey] = eventData[key];
    }
  });

  return eventData;
}