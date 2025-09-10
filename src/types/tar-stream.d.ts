declare module 'tar-stream' {
  interface Extract {
    on(
      event: 'entry',
      listener: (
        header: any,
        stream: NodeJS.ReadableStream,
        next: () => void,
      ) => void,
    ): this;
    on(event: 'finish' | 'error', listener: (err?: Error) => void): this;
    end(data: Buffer): void;
  }

  export function extract(): Extract;
}
