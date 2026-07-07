const fs = require('fs');
const file = 'appium/tests/android/ppv.handoff.spec.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "const androidAvailabilityResults: any[] = [];",
  "const androidAvailabilityResults: any[] = [];\n\n    // Create appiumEventData for mobile UI validation\n    const REGION = process.env.REGION || process.env.DAZN_REGION || 'GB';\n    const PPV_CONFIG = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';\n    const { buildEventData } = require('../../../utils/buildEventData');\n    const eventJson = require(`../../../config/events/${PPV_CONFIG}`);\n    const appiumEventData = buildEventData(eventJson, REGION, 'standard', 'monthly', SOURCE);"
);

content = content.replace("eventData.CURRENT_PAGE = 'Mobile Paywall';", "appiumEventData.CURRENT_PAGE = 'Mobile Paywall';");
content = content.replace("checkField('Rate Plan Price', eventData.RATE_PLAN_PRICE_STANDARD_MONTHLY);", "checkField('Rate Plan Price', appiumEventData.RATE_PLAN_PRICE_STANDARD_MONTHLY);");
content = content.replace("checkField('Today You Pay Price', eventData.TODAY_PAY_PRICE_STANDARD_MONTHLY);", "checkField('Today You Pay Price', appiumEventData.TODAY_PAY_PRICE_STANDARD_MONTHLY);");

content = content.replace("const titleExpected = eventData.MOBILE_BANNER_TITLE || eventData.PPV_DISPLAY_NAME || eventData.PPV_NAME;", "const titleExpected = appiumEventData.MOBILE_BANNER_TITLE || appiumEventData.PPV_DISPLAY_NAME || appiumEventData.PPV_NAME;");
content = content.replace("checkField('Date and Time', eventData.MOBILE_BANNER_DATE_TIME || eventData.MOBILE_BANNER_DATE || eventData.PPV_DATE);", "checkField('Date and Time', appiumEventData.MOBILE_BANNER_DATE_TIME || appiumEventData.MOBILE_BANNER_DATE || appiumEventData.PPV_DATE);");
content = content.replace("checkField('Sub Title', eventData.MOBILE_BANNER_SUB_TITLE || eventData.PPV_SUB_TITLE);", "checkField('Sub Title', appiumEventData.MOBILE_BANNER_SUB_TITLE || appiumEventData.PPV_SUB_TITLE);");
content = content.replace("checkField('Buy Button', eventData.MOBILE_BANNER_BUY_BUTTON || 'Buy now');", "checkField('Buy Button', appiumEventData.MOBILE_BANNER_BUY_BUTTON || 'Buy now');");
content = content.replace("checkField('Description', eventData.MOBILE_BANNER_DESCRIPTION || eventData.BANNER_DESCRIPTION);", "checkField('Description', appiumEventData.MOBILE_BANNER_DESCRIPTION || appiumEventData.BANNER_DESCRIPTION);");

fs.writeFileSync(file, content);
console.log('Done!');
