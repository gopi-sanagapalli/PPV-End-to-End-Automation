import { IOSBasePage } from "./IOSBasePage"
export class IOSValidationPage extends IOSBasePage {
  private readonly successMessage = `~Success!`;

  async isSuccessMessageVisible(): Promise<boolean> {
    return await this.driver.$(this.successMessage).isDisplayed();
  }
}
