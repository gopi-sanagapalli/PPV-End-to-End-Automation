import { validateVariant1 } from '../config/variant1';
import { validateVariant2 } from '../config/variant2';
import { validateVariant3 } from '../config/variant3';

export const validateVariant = async (
  page: any,
  variant: string,
  data: any[],
  results: any[]
) => {

  console.log('🚀 Running PPV Validation...');
  console.log('🧠 Variant:', variant);
  console.log('📊 Data Length:', data.length);

  if (variant === 'variant1') {
    await validateVariant1(page, data, results);
  }

  else if (variant === 'variant2') {
    await validateVariant2(page, data, results);
  }

  else if (variant === 'variant3') {
    await validateVariant3(page, data, results);
  }

  else {
    console.log('❌ Unknown variant');
  }
};