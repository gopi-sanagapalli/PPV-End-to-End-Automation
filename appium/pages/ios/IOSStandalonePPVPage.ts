import { IOSBasePage, WdBrowser } from './IOSBasePage';
import { IOSValidationResult } from './IOSValidationPage';
import { IOSSafariValidationPage } from './IOSSafariValidationPage';

export class IOSStandalonePPVPage extends IOSBasePage {
  constructor(driver: WdBrowser) {
    super(driver);
  }

  async isStandalonePPVPage(
    eventData: Record<string, any> | undefined,
    bodyTextLower: string,
    url: string,
  ): Promise<boolean> {
    if (String(eventData?.PPV_TYPE || '').toLowerCase() !== 'standalone') return false;
    if (!/contextualppvid=|\/account\/content\/.*\/signup/i.test(url)) return false;

    return await this.driver.execute(() => {
      const visible = (element: HTMLElement | null) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.opacity !== '0' && box.width > 0 && box.height > 0;
      };
      const hasTicket = visible(document.querySelector<HTMLElement>(
        'input[type="checkbox"], button[class*="ni7RX"]',
      ));
      const hasPlan = Array.from(document.querySelectorAll<HTMLElement>(
        'input[type="radio"], [role="radio"]',
      )).some(visible);
      const hasSubscriptionSection = /choose your subscription/i.test(document.body?.innerText || '');
      return hasTicket && hasPlan && hasSubscriptionSection;
    }).catch(() => false);
  }

  async waitUntilPageReady(): Promise<void> {
    await this.driver.waitUntil(async () => this.driver.execute(() => {
      const visible = (element: HTMLElement | null) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.opacity !== '0' && box.width > 0 && box.height > 0;
      };
      const hasTicket = visible(document.querySelector<HTMLElement>(
        'input[type="checkbox"], button[class*="ni7RX"]',
      ));
      const hasPlan = Array.from(document.querySelectorAll<HTMLElement>(
        'input[type="radio"], [role="radio"]',
      )).some(visible);
      return hasTicket && hasPlan && /choose your subscription/i.test(document.body?.innerText || '');
    }).catch(() => false), {
      timeout: 20000,
      interval: 250,
      timeoutMsg: 'Standalone PPV ticket and subscription plans did not become visible in Safari.',
    });
  }

  private async selectPlan(planType: 'flex' | 'annual_monthly'): Promise<void> {
    const label = planType === 'flex' ? 'flex' : 'annual pay monthly';
    const selected = await this.driver.execute((target: string) => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
      const visible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.opacity !== '0' && box.width > 0 && box.height > 0;
      };
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        'label, [role="radio"], button, input[type="radio"]',
      ));
      const control = controls.find(element => {
        const text = normalize(element.closest<HTMLElement>('label, [role="radio"], button, div')?.innerText || element.innerText || '');
        return visible(element) && text.includes(target);
      });
      if (!control) return false;
      if (control instanceof HTMLInputElement) {
        control.click();
      } else {
        control.click();
      }
      return true;
    }, label).catch(() => false);

    if (!selected) {
      throw new Error(`Standalone PPV ${planType} plan was not available to select.`);
    }

    await this.driver.waitUntil(async () => this.driver.execute((target: string) => {
      const selectedControl = document.querySelector<HTMLElement>(
        '[role="radio"][aria-checked="true"], input[type="radio"]:checked, [data-state="checked"]',
      );
      return (selectedControl?.closest<HTMLElement>('label, [role="radio"], div')?.innerText || '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .includes(target);
    }, label).catch(() => false), {
      timeout: 5000,
      interval: 200,
      timeoutMsg: `Standalone PPV ${planType} selection was not reflected in Safari.`,
    });
  }

  private async clickContinue(): Promise<void> {
    const clicked = await this.driver.execute(() => {
      const button = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'))
        .find(element => {
          const text = (element.innerText || (element as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
          const style = window.getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return /^continue\b/i.test(text) && style.display !== 'none' &&
            style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
        });
      if (!button) return false;
      button.click();
      return true;
    }).catch(() => false);
    if (!clicked) throw new Error('Standalone PPV Continue CTA was not available in Safari.');
  }

  async validateAndContinue(
    results: IOSValidationResult[],
    eventData: Record<string, any>,
  ): Promise<void> {
    await this.waitUntilPageReady();

    const ratePlan = String(eventData.RATE_PLAN || process.env.RATE_PLAN || 'monthly').toLowerCase();
    const planType: 'flex' | 'annual_monthly' = ratePlan.includes('annual') || ratePlan.includes('apm')
      ? 'annual_monthly'
      : 'flex';
    const validationPage = new IOSSafariValidationPage(this.driver);

    await this.selectPlan(planType);
    await validationPage.validateStandalonePPVPage(eventData, results, planType);
    await this.clickContinue();
  }
}
