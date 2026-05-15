import { useOnboarding } from './OnboardingProvider';
import { Step1CreateCard } from './Step1CreateCard';
import { Step2ActivateCard } from './Step2ActivateCard';
import { Step3ClickDay } from './Step3ClickDay';

/**
 * Mounts the active onboarding step OR returns null. Sits inside the
 * router tree (after `AppLayout`) so the spotlight selectors can find
 * the CardsHeader / DayCell DOM nodes.
 *
 * Render flow:
 *   - When the provider says `isActive === false` → render nothing. The
 *     mount cost is one context read + an early return.
 *   - When active → render the step matching `currentStep`. Each step
 *     component recomputes its own positioning every render.
 */
export function OnboardingHost() {
  const { isActive, currentStep } = useOnboarding();
  if (!isActive) return null;
  switch (currentStep) {
    case 1:
      return <Step1CreateCard />;
    case 2:
      return <Step2ActivateCard />;
    case 3:
      return <Step3ClickDay />;
    default:
      return null;
  }
}
