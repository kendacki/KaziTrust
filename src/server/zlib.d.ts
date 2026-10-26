declare module "node:zlib" {
  export function inflateRawSync(data: Uint8Array): Uint8Array;
}
