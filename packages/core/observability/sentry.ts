import {
  captureException,
  dedupeIntegration,
  flush,
  initWithoutDefaultIntegrations,
  linkedErrorsIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
} from "@sentry/node";
import { scrub } from "./scrub";

initWithoutDefaultIntegrations({
  integrations: [
    linkedErrorsIntegration(),
    dedupeIntegration(),
    onUncaughtExceptionIntegration(),
    onUnhandledRejectionIntegration(),
  ],
  beforeSend: scrub,
  initialScope: { tags: { function: process.env.AWS_LAMBDA_FUNCTION_NAME } },
});

export { captureException };

export const withSentry =
  <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
  async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      captureException(err);
      throw err;
    } finally {
      await flush(2000);
    }
  };
