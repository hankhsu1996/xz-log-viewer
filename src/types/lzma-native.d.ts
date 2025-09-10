declare module 'lzma-native' {
  export function decompress(data: Buffer): Promise<Buffer>;
}
