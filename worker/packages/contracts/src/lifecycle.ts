/** Generic lifecycle interfaces used across foundation components. No product meaning. */

/** Something that releases resources. `dispose` must be idempotent. */
export interface Disposable {
  dispose(): void | Promise<void>;
}

/** Deeply-readonly view of a structure (compile-time immutability aid). */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
