import type { SessionPlan } from "./desktop";

let samplePlans: SessionPlan[] = [];

export function readSamplePlans(): SessionPlan[] {
  return samplePlans.slice();
}

export function writeSamplePlans(plans: SessionPlan[]) {
  samplePlans = plans.slice();
}

export function resetSamplePlans() {
  samplePlans = [];
}
