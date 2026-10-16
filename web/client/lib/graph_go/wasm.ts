/**
 * Loads the two wasm modules and wires the engine to the CPU.
 *
 * Both speak the same convention (`wasm/core/src/abi.rs`): copy a JSON request into the module's
 * memory with `alloc`, call the export with its pointer and length, and read the response's
 * length bytes back from `result_ptr()`. A failure is answered as `{"error": "..."}`, which is
 * thrown here as a {@link GraphGoError}.
 *
 * The engine imports `cpu.judge` and `cpu.take_response`. They are bridged here: the request is
 * read out of the engine's memory, handed to the CPU module's `judge`, and the answer is held
 * until the engine asks for it to be copied into a buffer of its own.
 */

import type { Cpu, Engine } from "./types.ts";

export class GraphGoError extends Error {
  override name = "GraphGoError";
}

/** A wasm binary: its URL, or its bytes. */
export type WasmSource = string | URL | BufferSource;

interface AbiExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  result_ptr(): number;
  [name: string]: unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function bytesOf(source: WasmSource): Promise<BufferSource> {
  if (typeof source !== "string" && !(source instanceof URL)) return source;
  const response = await fetch(source);
  if (!response.ok) {
    throw new GraphGoError(`${source} answered ${response.status}`);
  }
  // Not `instantiateStreaming`: that needs `application/wasm`, and a static host may not say so.
  return await response.arrayBuffer();
}

/** Calls one export with raw request bytes, returning a copy of the raw response. */
function rawCall(
  exports: AbiExports,
  name: string,
  request: Uint8Array,
): Uint8Array {
  const fn = exports[name];
  if (typeof fn !== "function") throw new GraphGoError(`no export "${name}"`);
  const ptr = exports.alloc(request.length) >>> 0;
  new Uint8Array(exports.memory.buffer, ptr, request.length).set(request);
  const len = (fn as (p: number, l: number) => number)(ptr, request.length) >>>
    0;
  exports.dealloc(ptr, request.length);
  const out = exports.result_ptr() >>> 0;
  return new Uint8Array(exports.memory.buffer, out, len).slice();
}

function jsonCall<T>(exports: AbiExports, name: string, request: unknown): T {
  const answer = JSON.parse(
    decoder.decode(
      rawCall(exports, name, encoder.encode(JSON.stringify(request))),
    ),
  );
  if (answer && typeof answer === "object" && "error" in answer) {
    throw new GraphGoError(String(answer.error));
  }
  return answer as T;
}

export interface GraphGo {
  engine: Engine;
  cpu: Cpu;
}

/** Instantiates the CPU, then the engine with its `cpu.*` imports pointed at that CPU. */
export async function loadGraphGo(
  engineSource: WasmSource,
  cpuSource: WasmSource,
): Promise<GraphGo> {
  const [engineBytes, cpuBytes] = await Promise.all([
    bytesOf(engineSource),
    bytesOf(cpuSource),
  ]);
  const cpuInstance = await WebAssembly.instantiate(cpuBytes);
  const cpuExports = cpuInstance.instance.exports as unknown as AbiExports;

  let engineExports: AbiExports | null = null;
  let pending: Uint8Array = new Uint8Array(0);
  const engineInstance = await WebAssembly.instantiate(engineBytes, {
    cpu: {
      judge(ptr: number, len: number): number {
        const memory = engineExports!.memory.buffer;
        const request = new Uint8Array(memory, ptr >>> 0, len >>> 0).slice();
        pending = rawCall(cpuExports, "judge", request);
        return pending.length;
      },
      take_response(dst: number): void {
        new Uint8Array(engineExports!.memory.buffer, dst >>> 0, pending.length)
          .set(pending);
        pending = new Uint8Array(0);
      },
    },
  });
  engineExports = engineInstance.instance.exports as unknown as AbiExports;
  const engine = engineExports;

  return {
    engine: {
      play: (request) => jsonCall(engine, "play", request),
      regions: (request) => jsonCall(engine, "regions", request),
      evaluate: (request) => jsonCall(engine, "evaluate", request),
    },
    cpu: {
      judge: (subgraph) => jsonCall(cpuExports, "judge", subgraph),
      genmove: (request) => jsonCall(cpuExports, "genmove", request),
    },
  };
}
