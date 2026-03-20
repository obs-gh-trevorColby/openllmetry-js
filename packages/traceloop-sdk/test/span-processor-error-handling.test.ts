/*
 * Copyright Traceloop
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from "assert";
import { diag, DiagLogLevel } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  createSpanProcessor,
  ALL_INSTRUMENTATION_LIBRARIES,
} from "../src/lib/tracing/span-processor";

function createMockSpan(overrides: Record<string, unknown> = {}): ReadableSpan {
  return {
    name: "test-span",
    kind: 0,
    spanContext: () => ({
      traceId: "d4cda95b652f4a1592b449d5929fda1b",
      spanId: "6e0c63257de34c92",
      traceFlags: 1,
    }),
    parentSpanId: undefined,
    startTime: [0, 0],
    endTime: [1, 0],
    status: { code: 0 },
    attributes: {},
    links: [],
    events: [],
    duration: [1, 0],
    ended: true,
    resource: {
      attributes: {},
      merge: () => ({} as any),
    } as any,
    instrumentationLibrary: { name: "ai", version: "1.0.0" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  } as unknown as ReadableSpan;
}

describe("onSpanEnd error handling", () => {
  const errors: string[] = [];
  let originalLogger: ReturnType<typeof diag.createComponentLogger> | undefined;

  before(() => {
    diag.setLogger(
      {
        error: (message: string, ...args: unknown[]) => {
          errors.push(message);
        },
        warn: () => {},
        info: () => {},
        debug: () => {},
        verbose: () => {},
      },
      DiagLogLevel.ALL,
    );
  });

  afterEach(() => {
    errors.length = 0;
  });

  it("should not throw when span processing encounters an error", () => {
    const exporter = new InMemorySpanExporter();
    const processor = createSpanProcessor({
      exporter,
      disableBatch: true,
      allowedInstrumentationLibraries: ALL_INSTRUMENTATION_LIBRARIES,
    });

    const badSpan = createMockSpan({
      spanContext: () => {
        throw new Error("simulated spanContext failure");
      },
    });

    assert.doesNotThrow(() => {
      processor.onEnd(badSpan);
    });
  });

  it("should log via diag.error when span processing fails", () => {
    const exporter = new InMemorySpanExporter();
    const processor = createSpanProcessor({
      exporter,
      disableBatch: true,
      allowedInstrumentationLibraries: ALL_INSTRUMENTATION_LIBRARIES,
    });

    const badSpan = createMockSpan({
      spanContext: () => {
        throw new Error("simulated spanContext failure");
      },
    });

    processor.onEnd(badSpan);

    const traceloopErrors = errors.filter((e) =>
      e.includes("@traceloop/node-server-sdk"),
    );
    assert.ok(
      traceloopErrors.length > 0,
      "Expected diag.error to be called with traceloop error message",
    );
  });

  it("should still forward the span to the exporter on error", async () => {
    const exporter = new InMemorySpanExporter();
    const processor = createSpanProcessor({
      exporter,
      disableBatch: true,
      allowedInstrumentationLibraries: ALL_INSTRUMENTATION_LIBRARIES,
    });

    const badSpan = createMockSpan({
      attributes: {
        get [Symbol.iterator]() {
          throw new Error("attributes access failure");
        },
      },
      spanContext: () => {
        throw new Error("simulated failure");
      },
    });

    processor.onEnd(badSpan);

    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    assert.ok(
      spans.length > 0,
      "Expected the span to still be forwarded to the exporter via originalOnEnd fallback",
    );
  });

  it("should process normal spans without interference from try/catch", async () => {
    const exporter = new InMemorySpanExporter();
    const processor = createSpanProcessor({
      exporter,
      disableBatch: true,
      allowedInstrumentationLibraries: ALL_INSTRUMENTATION_LIBRARIES,
    });

    const normalSpan = createMockSpan();

    assert.doesNotThrow(() => {
      processor.onEnd(normalSpan);
    });

    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    assert.strictEqual(spans.length, 1, "Expected exactly one span exported");
  });
});
