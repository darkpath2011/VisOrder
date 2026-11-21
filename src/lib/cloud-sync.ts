/**
 * cloud-sync.ts orchestrates signed-in pull/merge across VisOrder's local-first
 * stores. Cognitive drills, suite summaries, aim session logs, sensitivity
 * recommendations, and aim control settings each own their table so sens fitting
 * never reads mixed drill+aim rows; this module only fans out the auth-triggered
 * sync so header login and route mounts stay one call site.
 */

import { pullAndMergeAimSessions } from "@/lib/aim-trainer/store/sessionLog";
import { pullAndMergeRecommendations } from "@/lib/aim-trainer/store/recommendation";
import { pullAndMergeSettings } from "@/lib/aim-trainer/store/settings";
import {
  pullAndMergeSessions,
  pullAndMergeSuiteRuns,
} from "@/lib/training-history";

/**
 * pullAndMergeAllUserData runs every local↔cloud merge for the signed-in user.
 * Call after SIGNED_IN and on /train or /aim mount; failures inside each store
 * are logged there so one offline table does not block the others.
 */
export async function pullAndMergeAllUserData(): Promise<void> {
  await Promise.all([
    pullAndMergeSessions(),
    pullAndMergeSuiteRuns(),
    pullAndMergeAimSessions(),
    pullAndMergeRecommendations(),
    pullAndMergeSettings(),
  ]);
}
