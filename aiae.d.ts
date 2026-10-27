declare module 'aiae' {
  export interface Session {
    createPipe<T = any>(): any;
    run(...args: any[]): any;
    [key: string]: any;
  }
  export namespace sessions {
    export function local(): Session;
  }
  export namespace content {
    export type AudioChunk = any;
    export type ImageChunk = any;
    export type Chunk = any;
    export type UserPrompt = any;
    export type AssistantPrompt = any;
    export function audioChunksToMediaStream(callback: any): any;
    export function mediaStreamToAudioChunks(stream: any): any;
    export function mediaStreamToImageChunks(stream: any): any;
    export const isChunk: any;
    export const isDataChunk: any;
    export const isJsonChunk: any;
    export const isProtoMessage: any;
    export const isRefChunk: any;
    export const isTextChunk: any;
    export const jsonChunk: any;
    export const textChunk: any;
    export const userPrompt: any;
    export const assistantPrompt: any;
    export const systemPrompt: any;
    export const contextPrompt: any;
    export const imageChunk: any;
    export const videoChunk: any;
    export const audioChunk: any;
    export const blobChunk: any;
    export const chunkBlob: any;
    export const chunkJson: any;
    export const chunkText: any;
  }
  export namespace actions {
    export namespace google {
      export namespace genai {
        export class Live {
          constructor(mode?: string, model?: string);
        }
      }
    }
  }
  export const Action: any;
  export const async: any;
  export const base64: any;
  export const stream: any;
}
