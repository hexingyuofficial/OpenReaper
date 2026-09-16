/**
 * Run an ordered list of pipeline steps with consistent logging.
 *
 * `alwaysRun: true` steps still execute after an earlier failure so Start can
 * publish face-config even when the engine step is degraded.
 *
 * @param {object} params
 * @param {readonly {id: string, label: string, alwaysRun?: boolean, run: (ctx: object) => Promise<void>}[]} params.steps
 * @param {object} params.ctx
 */
export async function runPipeline({ steps, ctx }) {
  const total = steps.length;
  let firstError = null;
  for (let index = 0; index < total; index += 1) {
    const step = steps[index];
    process.stdout.write(
      `[OpenReaper Studio] [${index + 1}/${total}] ${step.id}: ${step.label}…\n`,
    );
    if (firstError && !step.alwaysRun) {
      ctx.log?.(`Skipping ${step.id} after earlier failure.`);
      continue;
    }
    try {
      await step.run(ctx);
    } catch (error) {
      firstError = firstError ?? error;
      ctx.log?.(`${step.id} failed: ${error?.message ?? error}`);
    }
  }
  if (firstError) {
    throw firstError;
  }
}

export function createStudioLog() {
  return (message) => {
    process.stdout.write(`[OpenReaper Studio] ${message}\n`);
  };
}
