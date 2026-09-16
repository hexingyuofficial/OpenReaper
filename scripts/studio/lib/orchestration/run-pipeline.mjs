/**
 * Run an ordered list of pipeline steps with consistent logging.
 *
 * @param {object} params
 * @param {readonly {id: string, label: string, run: (ctx: object) => Promise<void>}[]} params.steps
 * @param {object} params.ctx
 */
export async function runPipeline({ steps, ctx }) {
  const total = steps.length;
  for (let index = 0; index < total; index += 1) {
    const step = steps[index];
    process.stdout.write(
      `[OpenReaper Studio] [${index + 1}/${total}] ${step.id}: ${step.label}…\n`,
    );
    await step.run(ctx);
  }
}

export function createStudioLog() {
  return (message) => {
    process.stdout.write(`[OpenReaper Studio] ${message}\n`);
  };
}
