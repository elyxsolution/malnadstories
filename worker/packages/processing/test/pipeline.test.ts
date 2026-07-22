import { describe, expect, it } from 'vitest';
import { definePipeline, PipelineDefinitionError } from '@workerv2/processing';
import { diamondSteps, pipelineSpec, step, unwrap, unwrapErr } from './helpers.js';

describe('definePipeline — validation happy path', () => {
  it('builds a validated, immutable pipeline with defaults applied', () => {
    const pipeline = unwrap(definePipeline(pipelineSpec(diamondSteps())));
    expect(pipeline.id).toBe('pl-1');
    expect(pipeline.name).toBe('pl-1'); // defaulted
    expect(pipeline.version).toBe('1.0.0');
    expect(pipeline.steps).toHaveLength(4);

    const ingest = pipeline.steps.find((s) => s.id === 'ingest');
    expect(ingest?.retry.maxAttempts).toBe(1); // NO_RETRY default
    expect(ingest?.cancellation.mode).toBe('cooperative'); // DEFAULT_CANCELLATION
    expect(ingest?.failure.onTransient).toBe('retry'); // DEFAULT_FAILURE_POLICY
    expect(ingest?.config).toStrictEqual({});
  });

  it('deep-freezes the pipeline (immutability)', () => {
    const pipeline = unwrap(definePipeline(pipelineSpec(diamondSteps())));
    expect(Object.isFrozen(pipeline)).toBe(true);
    expect(Object.isFrozen(pipeline.steps)).toBe(true);
    for (const s of pipeline.steps) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.inputs)).toBe(true);
      expect(Object.isFrozen(s.outputs)).toBe(true);
      expect(Object.isFrozen(s.retry)).toBe(true);
    }
  });

  it('is deterministic: the same spec yields a structurally identical pipeline', () => {
    const a = unwrap(definePipeline(pipelineSpec(diamondSteps())));
    const b = unwrap(definePipeline(pipelineSpec(diamondSteps())));
    expect(a).toStrictEqual(b);
  });

  it('carries capability requirements + processor version ranges through', () => {
    const pipeline = unwrap(
      definePipeline(
        pipelineSpec([
          step('s1', {
            processorVersionRange: '^2.0.0',
            requires: [{ name: 'image-engine', versionRange: '^1.0.0' }, { name: 'gpu' }],
          }),
        ]),
      ),
    );
    const s1 = pipeline.steps[0];
    expect(s1?.processorVersionRange).toBe('^2.0.0');
    expect(s1?.requires).toStrictEqual([
      { name: 'image-engine', versionRange: '^1.0.0' },
      { name: 'gpu' },
    ]);
  });
});

describe('definePipeline — rejections', () => {
  const expectRejected = (specSteps: Parameters<typeof pipelineSpec>[0], pattern: RegExp): void => {
    const result = definePipeline(pipelineSpec(specSteps));
    const error = unwrapErr(result);
    expect(error).toBeInstanceOf(PipelineDefinitionError);
    expect(error.message).toMatch(pattern);
  };

  it('rejects an invalid pipeline id / version / empty steps', () => {
    expect(definePipeline({ id: ' ', version: '1.0.0', steps: [step('a')] }).ok).toBe(false);
    expect(definePipeline({ id: 'pl', version: 'one', steps: [step('a')] }).ok).toBe(false);
    expect(definePipeline({ id: 'pl', version: '1.0.0', steps: [] }).ok).toBe(false);
  });

  it('rejects duplicate step ids', () => {
    expectRejected([step('a'), step('a')], /Duplicate step id/);
  });

  it('rejects an unknown dependency', () => {
    expectRejected([step('a', { dependsOn: ['ghost'] })], /unknown step "ghost"/);
  });

  it('rejects a self-dependency', () => {
    expectRejected([step('a', { dependsOn: ['a'] })], /depends on itself/);
  });

  it('rejects a duplicate dependency listing', () => {
    expectRejected(
      [step('a'), step('b', { dependsOn: ['a', 'a'] })],
      /lists dependency "a" more than once/,
    );
  });

  it('rejects a dependency cycle (DAG validation)', () => {
    expectRejected([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })], /cycle/);
  });

  it('rejects an input bound to an unknown producer step', () => {
    expectRejected(
      [step('a', { inputs: { x: { kind: 'step-output', stepId: 'ghost', output: 'out' } } })],
      /references unknown step "ghost"/,
    );
  });

  it('rejects an input bound to an undeclared output', () => {
    expectRejected(
      [
        step('p', { outputs: ['real'] }),
        step('c', {
          dependsOn: ['p'],
          inputs: { x: { kind: 'step-output', stepId: 'p', output: 'fake' } },
        }),
      ],
      /undeclared output "fake"/,
    );
  });

  it('rejects consuming a step output without declaring the dependency', () => {
    expectRejected(
      [
        step('p', { outputs: ['out'] }),
        step('c', { inputs: { x: { kind: 'step-output', stepId: 'p', output: 'out' } } }),
      ],
      /does not declare it in dependsOn/,
    );
  });

  it('rejects invalid slot names, duplicate outputs, and empty artifact keys', () => {
    expectRejected([step('a', { outputs: ['bad slot!'] })], /invalid output slot name/);
    expectRejected([step('a', { outputs: ['x', 'x'] })], /declares output "x" more than once/);
    expectRejected(
      [step('a', { inputs: { ' bad': { kind: 'artifact', key: 'sha256:aa' } } })],
      /invalid input slot name/,
    );
    expectRejected(
      [step('a', { inputs: { raw: { kind: 'artifact', key: '  ' } } })],
      /empty artifact key/,
    );
  });

  it('rejects invalid processor names and capability requirements', () => {
    expectRejected([step('a', { processor: '  ' })], /invalid processor name/);
    expectRejected([step('a', { processorVersionRange: ' ' })], /empty processorVersionRange/);
    expectRejected([step('a', { requires: [{ name: '' }] })], /invalid capability requirement/);
  });

  it('rejects invalid step policies (validated at the pipeline boundary)', () => {
    expectRejected(
      [step('a', { retry: { maxAttempts: 0, backoff: 'none', initialDelayMs: 0 } })],
      /maxAttempts/,
    );
    expectRejected([step('a', { timeout: { attemptTimeoutMs: 0 } })], /attemptTimeoutMs/);
    expectRejected(
      [step('a', { cancellation: { mode: 'abortive', gracePeriodMs: 5 } })],
      /gracePeriodMs/,
    );
  });
});
